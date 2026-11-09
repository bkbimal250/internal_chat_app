import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { attachments, conversations, conversationMembers, messages } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { conversationService } from '../conversations/conversations.service.js';
import { assertReplyTo } from '../messages/message-references.js';
import { assertDeclaredType, inspectUploadedObject, sanitizeFileName } from '../../services/file-kind.js';
import { createStorageKey } from '../../services/object-storage.service.js';
import { assertPartNumbers, normalizeParts, planUpload } from '../../services/upload-plan.js';
import { expiresAtForInsert } from '../retention/expires-at.js';
import { assertGroupSend } from '../groups/group-permissions.js';

const INLINE_KINDS = new Set(['image', 'video', 'audio']);

export function publicAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    kind: row.kind,
    status: row.status,
    checksumSha256: row.checksumSha256 || null,
  };
}

export function attachmentsService(app, config) {
  const db = app.database.db;
  const conversationsService = conversationService(app);
  const storage = app.storage;
  const activeMember = (tx, conversationId, userId) =>
    tx
      .select()
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.userId, userId),
          isNull(conversationMembers.leftAt),
        ),
      )
      .for('update');

  async function dailyUsage(userId) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ total }] = await db
      .select({ total: sql`coalesce(sum(${attachments.sizeBytes}), 0)::bigint` })
      .from(attachments)
      .where(
        and(
          eq(attachments.uploaderId, userId),
          gte(attachments.createdAt, since),
          sql`${attachments.status} in ('pending','quarantined','available')`,
        ),
      );
    return Number(total ?? 0);
  }

  async function insertMessage(tx, { conversationId, userId, clientMessageId, content, kind, replyToMessageId }) {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update');
    if (!conversation) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
    const [membership] = await activeMember(tx, conversationId, userId);
    if (!membership) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
    if (clientMessageId) {
      const [duplicate] = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.clientMessageId, clientMessageId)));
      if (duplicate) return { message: duplicate, duplicate: true };
    }
    await assertReplyTo(tx, { conversation, userId, replyToMessageId });
    const [c] = await tx
      .update(conversations)
      .set({
        lastMessageSeq: sql`${conversations.lastMessageSeq} + 1`,
        lastChangeSeq: sql`${conversations.lastChangeSeq} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId))
      .returning();
    const expiresAt = await expiresAtForInsert(tx);
    const [message] = await tx
      .insert(messages)
      .values({
        conversationId,
        senderId: userId,
        clientMessageId,
        sequenceNumber: c.lastMessageSeq,
        changeSeq: c.lastChangeSeq,
        messageType: kind,
        content: content ?? '',
        replyToMessageId,
        expiresAt,
      })
      .returning();
    return { message, duplicate: false };
  }

  function assertWritable() {
    if (!config?.chatAttachmentsEnabled) {
      throw new AppError('Chat attachments are not enabled', 503, 'ATTACHMENTS_DISABLED');
    }
    if (!storage.enabled) throw new AppError('File storage is unavailable', 503, 'STORAGE_UNAVAILABLE');
  }

  return {
    publicAttachment,
    async hydrate(message) {
      if (!message) return message;
      const [attachment] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.messageId, message.id), eq(attachments.status, 'available')));
      return { ...message, attachment: publicAttachment(attachment) };
    },
    async hydrateMany(rows) {
      if (!rows.length) return rows;
      const ids = rows.map((row) => row.id);
      const files = await db
        .select()
        .from(attachments)
        .where(and(inArray(attachments.messageId, ids), eq(attachments.status, 'available')));
      const byMessage = new Map(files.map((row) => [row.messageId, row]));
      return rows.map((row) => ({ ...row, attachment: publicAttachment(byMessage.get(row.id)) }));
    },
    async init(conversationId, userId, input) {
      assertWritable();
      const { conversation, member } = await conversationsService.assertMember(conversationId, userId);
      assertGroupSend(conversation, member.role);
      const spec = assertDeclaredType(input.mimeType, input.sizeBytes);
      const used = await dailyUsage(userId);
      if (used + input.sizeBytes > config.attachmentDailyQuotaBytes) {
        throw new AppError('Daily upload quota exceeded', 429, 'QUOTA_EXCEEDED');
      }
      const [{ pending }] = await db
        .select({ pending: sql`count(*)::int` })
        .from(attachments)
        .where(and(eq(attachments.uploaderId, userId), eq(attachments.status, 'pending')));
      if (pending >= 20) throw new AppError('Too many unfinished uploads', 429, 'QUOTA_EXCEEDED');
      const storageKey = createStorageKey();
      const uploadExpiresAt = new Date(Date.now() + config.attachmentPendingTtlMs);
      const plan = planUpload(input.sizeBytes, input.strategy);
      const multipartUploadId =
        plan.mode === 'multipart' ? await storage.createMultipartUpload(storageKey, input.mimeType) : null;
      const [row] = await db
        .insert(attachments)
        .values({
          conversationId,
          uploaderId: userId,
          storageKey,
          originalName: sanitizeFileName(input.fileName),
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          kind: spec.kind,
          status: 'pending',
          multipartUploadId,
          uploadExpiresAt,
        })
        .returning();
      const headers = { 'Content-Type': input.mimeType };
      const shared = {
        id: row.id,
        mode: plan.mode,
        headers,
        expiresAt: uploadExpiresAt.toISOString(),
        maxBytes: spec.maxBytes,
        partSize: plan.partSize,
        partCount: plan.partCount,
      };
      if (plan.mode === 'single') {
        return {
          ...shared,
          uploadUrl: await storage.presignUpload(storageKey, input.mimeType, config.s3UploadTtlSeconds),
        };
      }
      return shared;
    },
    async requirePendingUploader(id, userId) {
      const [existing] = await db.select().from(attachments).where(eq(attachments.id, id));
      if (!existing || existing.uploaderId !== userId) throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      await conversationsService.assertMember(existing.conversationId, userId);
      if (existing.status !== 'pending') throw new AppError('Upload is not pending', 409, 'CONFLICT');
      if (existing.uploadExpiresAt && existing.uploadExpiresAt.getTime() < Date.now()) {
        throw new AppError('Upload expired', 410, 'UPLOAD_EXPIRED');
      }
      return existing;
    },
    async signParts(id, userId, input) {
      assertWritable();
      const existing = await this.requirePendingUploader(id, userId);
      if (!existing.multipartUploadId) throw new AppError('Upload is not multipart', 409, 'CONFLICT');
      const plan = planUpload(existing.sizeBytes, 'multipart');
      const partNumbers = assertPartNumbers(input.partNumbers, plan.partCount);
      if (!partNumbers) throw new AppError('Part numbers are invalid', 400, 'VALIDATION_ERROR');
      const expiresAt = new Date(Date.now() + config.s3UploadTtlSeconds * 1000).toISOString();
      const parts = [];
      for (const partNumber of partNumbers) {
        parts.push({
          partNumber,
          uploadUrl: await storage.presignUploadPart(
            existing.storageKey,
            existing.multipartUploadId,
            partNumber,
            config.s3UploadTtlSeconds,
          ),
          headers: {},
          expiresAt,
        });
      }
      return { id: existing.id, partSize: plan.partSize, partCount: plan.partCount, parts };
    },
    async listUploadedParts(id, userId) {
      assertWritable();
      const existing = await this.requirePendingUploader(id, userId);
      if (!existing.multipartUploadId) {
        return { id: existing.id, mode: 'single', parts: [], partSize: existing.sizeBytes, partCount: 1 };
      }
      const plan = planUpload(existing.sizeBytes, 'multipart');
      const parts = await storage.listParts(existing.storageKey, existing.multipartUploadId);
      return {
        id: existing.id,
        mode: 'multipart',
        partSize: plan.partSize,
        partCount: plan.partCount,
        sizeBytes: existing.sizeBytes,
        parts,
      };
    },
    async finalize(id, userId, input) {
      assertWritable();
      const [current] = await db.select().from(attachments).where(eq(attachments.id, id));
      if (!current || current.uploaderId !== userId) throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      await conversationsService.assertMember(current.conversationId, userId);
      if (current.status === 'available' && current.messageId) {
        const [message] = await db.select().from(messages).where(eq(messages.id, current.messageId));
        const hydrated = await this.hydrate(message);
        return { ...hydrated, duplicate: true };
      }
      if (current.status === 'quarantined' && !current.messageId) {
        throw new AppError('Upload is already being finalized', 409, 'CONFLICT');
      }
      if (current.status !== 'pending') throw new AppError('Upload is not pending', 409, 'CONFLICT');
      if (current.uploadExpiresAt && current.uploadExpiresAt.getTime() < Date.now()) {
        throw new AppError('Upload expired', 410, 'UPLOAD_EXPIRED');
      }
      const [existing] = await db
        .update(attachments)
        .set({ status: 'quarantined' })
        .where(and(eq(attachments.id, id), eq(attachments.status, 'pending')))
        .returning();
      if (!existing) {
        const [again] = await db.select().from(attachments).where(eq(attachments.id, id));
        if (again?.status === 'available' && again.messageId) {
          const [message] = await db.select().from(messages).where(eq(messages.id, again.messageId));
          const hydrated = await this.hydrate(message);
          return { ...hydrated, duplicate: true };
        }
        throw new AppError('Upload is already being finalized', 409, 'CONFLICT');
      }
      const releasePending = async () => {
        await db
          .update(attachments)
          .set({ status: 'pending' })
          .where(and(eq(attachments.id, id), eq(attachments.status, 'quarantined'), isNull(attachments.messageId)));
      };
      try {
      if (existing.multipartUploadId) {
        const head = await storage.head(existing.storageKey);
        if (!head) {
          const plan = planUpload(existing.sizeBytes, 'multipart');
          const clientParts = normalizeParts(input.parts, plan.partCount);
          const listed = clientParts ?? (await storage.listParts(existing.storageKey, existing.multipartUploadId));
          const uploadedBytes = listed.reduce((sum, part) => sum + Number(part.sizeBytes ?? 0), 0);
          if (!listed.length || listed.length !== plan.partCount) {
            throw new AppError('Uploaded object was not found', 409, 'UPLOAD_INCOMPLETE');
          }
          if (!clientParts && uploadedBytes !== existing.sizeBytes) {
            throw new AppError('Uploaded size does not match', 409, 'UPLOAD_INCOMPLETE');
          }
          await storage.completeMultipart(existing.storageKey, existing.multipartUploadId, listed);
        }
      }
      const head = await storage.head(existing.storageKey);
      if (!head) throw new AppError('Uploaded object was not found', 409, 'UPLOAD_INCOMPLETE');
      const size = Number(head.ContentLength ?? 0);
      if (size !== existing.sizeBytes) {
        await db
          .update(attachments)
          .set({
            status: 'rejected',
            rejectionReason: 'SIZE_MISMATCH',
            deletedAt: new Date(),
          })
          .where(eq(attachments.id, id));
        await storage.remove(existing.storageKey).catch(() => {});
        throw new AppError('Uploaded size does not match', 400, 'INVALID_UPLOAD');
      }
      let checksum;
      try {
        await inspectUploadedObject(storage, existing.storageKey, existing.mimeType, existing.sizeBytes);
        checksum = await storage.hashObject(existing.storageKey);
      } catch (error) {
        await db
          .update(attachments)
          .set({
            status: 'rejected',
            rejectionReason: error instanceof AppError ? error.code : 'SCAN_FAILED',
            deletedAt: new Date(),
          })
          .where(eq(attachments.id, id));
        await storage.remove(existing.storageKey).catch(() => {});
        throw error instanceof AppError ? error : new AppError('File failed security checks', 415, 'UNSUPPORTED_MEDIA_TYPE');
      }
      if (input.checksumSha256 && String(input.checksumSha256).toLowerCase() !== checksum) {
        await db
          .update(attachments)
          .set({
            status: 'rejected',
            rejectionReason: 'CHECKSUM_MISMATCH',
            deletedAt: new Date(),
          })
          .where(eq(attachments.id, id));
        await storage.remove(existing.storageKey).catch(() => {});
        throw new AppError('Uploaded checksum does not match', 400, 'INVALID_UPLOAD');
      }
      return db.transaction(async (tx) => {
        const created = await insertMessage(tx, {
          conversationId: existing.conversationId,
          userId,
          clientMessageId: input.clientMessageId,
          content: input.caption?.trim() ?? '',
          kind: existing.kind,
          replyToMessageId: input.replyToMessageId,
        });
        if (created.duplicate) {
          await tx
            .update(attachments)
            .set({
              status: 'deleted',
              deletedAt: new Date(),
              rejectionReason: 'duplicate_client_message',
            })
            .where(eq(attachments.id, id));
          const [attached] = await tx
            .select()
            .from(attachments)
            .where(and(eq(attachments.messageId, created.message.id), eq(attachments.status, 'available')));
          await storage.remove(existing.storageKey).catch(() => {});
          return {
            ...created.message,
            attachment: publicAttachment(attached),
            duplicate: true,
          };
        }
        const [updated] = await tx
          .update(attachments)
          .set({
            status: 'available',
            checksumSha256: checksum,
            messageId: created.message.id,
            finalizedAt: new Date(),
            uploadExpiresAt: null,
          })
          .where(eq(attachments.id, id))
          .returning();
        return { ...created.message, attachment: publicAttachment(updated), duplicate: false };
      });
      } catch (error) {
        if (!(error instanceof AppError) || !['UNSUPPORTED_MEDIA_TYPE', 'INVALID_UPLOAD'].includes(error.code)) {
          await releasePending();
        }
        throw error;
      }
    },
    async downloadUrl(id, userId, { download = false } = {}) {
      const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
      if (!row || row.status !== 'available' || row.deletedAt) {
        throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      }
      if (row.messageId) {
        const [message] = await db.select().from(messages).where(eq(messages.id, row.messageId));
        if (!message || message.deletedAt) throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      }
      await conversationsService.assertMember(row.conversationId, userId);
      const expiresIn = config.s3DownloadTtlSeconds;
      const inline = INLINE_KINDS.has(row.kind) && !download;
      const url = await storage.presignDownload(row.storageKey, {
        mimeType: row.mimeType,
        fileName: row.originalName,
        inline,
        expiresIn,
      });
      return {
        url,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        mimeType: row.mimeType,
        fileName: row.originalName,
        inline,
      };
    },
    async destroy(id, userId) {
      assertWritable();
      const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
      if (!row) throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      if (row.status === 'available') return this.remove(id, userId);
      await this.cancel(id, userId);
      return null;
    },
    async cancel(id, userId) {
      assertWritable();
      const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
      if (!row || row.uploaderId !== userId) throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      if (row.status === 'available') throw new AppError('Available files cannot be cancelled', 409, 'CONFLICT');
      if (row.status === 'deleted') return { success: true };
      const [cancelled] = await db
        .update(attachments)
        .set({ status: 'deleted', deletedAt: new Date(), multipartUploadId: null })
        .where(and(eq(attachments.id, id), eq(attachments.status, 'pending')))
        .returning();
      if (!cancelled) throw new AppError('Upload is being finalized', 409, 'CONFLICT');
      await storage.abortMultipart(row.storageKey, row.multipartUploadId);
      await storage.remove(row.storageKey).catch(() => {});
      return { success: true };
    },
    async remove(id, userId) {
      assertWritable();
      const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
      if (!row || row.status !== 'available') throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      if (row.uploaderId !== userId) throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      await conversationsService.assertMember(row.conversationId, userId);
      return db.transaction(async (tx) => {
        const [c] = await tx
          .update(conversations)
          .set({ lastChangeSeq: sql`${conversations.lastChangeSeq} + 1`, updatedAt: new Date() })
          .where(eq(conversations.id, row.conversationId))
          .returning({ lastChangeSeq: conversations.lastChangeSeq });
        let message = null;
        if (row.messageId) {
          [message] = await tx
            .update(messages)
            .set({ deletedAt: new Date(), content: '', changeSeq: c.lastChangeSeq })
            .where(and(eq(messages.id, row.messageId), isNull(messages.deletedAt)))
            .returning();
        }
        await tx
          .update(attachments)
          .set({ status: 'deleted', deletedAt: new Date() })
          .where(eq(attachments.id, id));
        return message;
      }).then(async (message) => {
        await storage.remove(row.storageKey).catch(() => {});
        return message;
      });
    },
    async forward(sourceMessageId, userId, input) {
      assertWritable();
      const [source] = await db.select().from(messages).where(eq(messages.id, sourceMessageId));
      if (!source || source.deletedAt) throw new AppError('Message not found', 404, 'NOT_FOUND');
      await conversationsService.assertMember(source.conversationId, userId);
      const dest = await conversationsService.assertMember(input.conversationId, userId);
      assertGroupSend(dest.conversation, dest.member.role);
      const [file] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.messageId, source.id), eq(attachments.status, 'available')));
      if (!file) throw new AppError('Referenced message unavailable', 400, 'INVALID_REFERENCE');
      const storageKey = createStorageKey();
      await storage.copyObject(file.storageKey, storageKey);
      return db.transaction(async (tx) => {
        const created = await insertMessage(tx, {
          conversationId: input.conversationId,
          userId,
          clientMessageId: input.clientMessageId,
          content: source.content,
          kind: file.kind,
          replyToMessageId: undefined,
        });
        const [copied] = await tx
          .insert(attachments)
          .values({
            conversationId: input.conversationId,
            uploaderId: userId,
            messageId: created.message.id,
            storageKey,
            originalName: file.originalName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            checksumSha256: file.checksumSha256,
            kind: file.kind,
            status: 'available',
            finalizedAt: new Date(),
          })
          .returning();
        await tx
          .update(messages)
          .set({ forwardedFromMessageId: source.id })
          .where(eq(messages.id, created.message.id));
        return {
          ...created.message,
          forwardedFromMessageId: source.id,
          attachment: publicAttachment(copied),
          duplicate: created.duplicate,
        };
      });
    },
  };
}
