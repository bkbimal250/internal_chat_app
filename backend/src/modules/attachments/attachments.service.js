import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { attachments, conversations, conversationMembers, messages } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { conversationService } from '../conversations/conversations.service.js';
import { assertDeclaredType, inspectContent, sanitizeFileName } from '../../services/file-kind.js';
import { createStorageKey } from '../../services/object-storage.service.js';

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
    if (replyToMessageId) {
      const [reply] = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.id, replyToMessageId),
            eq(messages.conversationId, conversationId),
            isNull(messages.deletedAt),
          ),
        );
      if (!reply) throw new AppError('Referenced message unavailable', 400, 'INVALID_REFERENCE');
    }
    const [c] = await tx
      .update(conversations)
      .set({
        lastMessageSeq: sql`${conversations.lastMessageSeq} + 1`,
        lastChangeSeq: sql`${conversations.lastChangeSeq} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId))
      .returning();
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
      })
      .returning();
    return { message, duplicate: false };
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
      await conversationsService.assertMember(conversationId, userId);
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
      if (!storage.enabled) throw new AppError('File storage is unavailable', 503, 'STORAGE_UNAVAILABLE');
      const storageKey = createStorageKey();
      const uploadExpiresAt = new Date(Date.now() + config.attachmentPendingTtlMs);
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
          uploadExpiresAt,
        })
        .returning();
      const uploadUrl = await storage.presignUpload(storageKey, input.mimeType, config.s3UploadTtlSeconds);
      return {
        id: row.id,
        uploadUrl,
        headers: { 'Content-Type': input.mimeType },
        expiresAt: uploadExpiresAt.toISOString(),
        maxBytes: spec.maxBytes,
      };
    },
    async finalize(id, userId, input) {
      const [existing] = await db.select().from(attachments).where(eq(attachments.id, id));
      if (!existing || existing.uploaderId !== userId) throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      await conversationsService.assertMember(existing.conversationId, userId);
      if (existing.status === 'available' && existing.messageId) {
        const [message] = await db.select().from(messages).where(eq(messages.id, existing.messageId));
        return this.hydrate(message);
      }
      if (existing.status !== 'pending') throw new AppError('Upload is not pending', 409, 'CONFLICT');
      if (existing.uploadExpiresAt && existing.uploadExpiresAt.getTime() < Date.now()) {
        throw new AppError('Upload expired', 410, 'UPLOAD_EXPIRED');
      }
      const head = await storage.head(existing.storageKey);
      if (!head) throw new AppError('Uploaded object was not found', 409, 'UPLOAD_INCOMPLETE');
      const size = Number(head.ContentLength ?? 0);
      if (size !== existing.sizeBytes) throw new AppError('Uploaded size does not match', 400, 'INVALID_UPLOAD');
      await db.update(attachments).set({ status: 'quarantined' }).where(eq(attachments.id, id));
      let buffer;
      try {
        buffer = await storage.getObjectBuffer(existing.storageKey, existing.sizeBytes);
        await inspectContent(buffer, existing.mimeType);
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
      const checksum = storage.sha256(buffer);
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
    },
    async downloadUrl(id, userId) {
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
      const url = await storage.presignDownload(row.storageKey, {
        mimeType: row.mimeType,
        fileName: row.originalName,
        inline: INLINE_KINDS.has(row.kind),
        expiresIn,
      });
      return {
        url,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        mimeType: row.mimeType,
        fileName: row.originalName,
        inline: INLINE_KINDS.has(row.kind),
      };
    },
    async destroy(id, userId) {
      const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
      if (!row) throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      if (row.status === 'available') return this.remove(id, userId);
      await this.cancel(id, userId);
      return null;
    },
    async cancel(id, userId) {
      const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
      if (!row || row.uploaderId !== userId) throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      if (row.status === 'available') throw new AppError('Available files cannot be cancelled', 409, 'CONFLICT');
      await db
        .update(attachments)
        .set({ status: 'deleted', deletedAt: new Date() })
        .where(eq(attachments.id, id));
      await storage.remove(row.storageKey).catch(() => {});
      return { success: true };
    },
    async remove(id, userId) {
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
      const [source] = await db.select().from(messages).where(eq(messages.id, sourceMessageId));
      if (!source || source.deletedAt) throw new AppError('Message not found', 404, 'NOT_FOUND');
      await conversationsService.assertMember(source.conversationId, userId);
      await conversationsService.assertMember(input.conversationId, userId);
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
