import { and, asc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { attachments, conversations, conversationMembers, messages } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { conversationService } from '../conversations/conversations.service.js';
import { assertReplyTo } from '../messages/message-references.js';
import { assertDeclaredType, inspectUploadedObject, sanitizeFileName } from '../../services/file-kind.js';
import { createStorageKey } from '../../services/object-storage.service.js';
import {
  assertPartNumbers,
  MAX_ATTACHMENT_BATCH,
  MAX_PENDING_UPLOADS,
  MAX_ZIP_BYTES,
  normalizeParts,
  planUpload,
} from '../../services/upload-plan.js';
import { expiresAtForInsert } from '../retention/expires-at.js';
import { assertGroupSend } from '../groups/group-permissions.js';
import {
  archiveFileName,
  contentDispositionAttachment,
  displayFileName,
  uniqueDisplayNames,
} from '../../services/michat-filename.js';
import { streamZipArchive, zipOutputStream } from '../../services/zip-archive.js';

const INLINE_KINDS = new Set(['image', 'video', 'audio']);

export function publicAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: displayFileName(row),
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    kind: row.kind,
    status: row.status,
    sortOrder: Number(row.sortOrder ?? 0),
    checksumSha256: row.checksumSha256 || null,
  };
}

export function presentAttachments(files = []) {
  const list = (Array.isArray(files) ? files : [])
    .filter(Boolean)
    .map(publicAttachment)
    .filter(Boolean);
  return { attachment: list[0] || null, attachments: list };
}

export function batchMessageType(kinds = []) {
  if (!kinds.length) return 'file';
  const unique = new Set(kinds);
  return unique.size === 1 ? kinds[0] : 'file';
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

  async function rejectUpload(id, storageKey, reason, error) {
    await db
      .update(attachments)
      .set({
        status: 'rejected',
        rejectionReason: reason,
        deletedAt: new Date(),
      })
      .where(eq(attachments.id, id));
    await storage.remove(storageKey).catch(() => {});
    throw error;
  }

  async function completeUploadedObject(existing, input = {}) {
    if (existing.multipartUploadId) {
      const already = await storage.head(existing.storageKey);
      if (!already) {
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
      await rejectUpload(
        existing.id,
        existing.storageKey,
        'SIZE_MISMATCH',
        new AppError('Uploaded size does not match', 400, 'INVALID_UPLOAD'),
      );
    }
    let checksum;
    try {
      await inspectUploadedObject(storage, existing.storageKey, existing.mimeType, existing.sizeBytes);
      checksum = await storage.hashObject(existing.storageKey);
    } catch (error) {
      await rejectUpload(
        existing.id,
        existing.storageKey,
        error instanceof AppError ? error.code : 'SCAN_FAILED',
        error instanceof AppError ? error : new AppError('File failed security checks', 415, 'UNSUPPORTED_MEDIA_TYPE'),
      );
    }
    if (input.checksumSha256 && String(input.checksumSha256).toLowerCase() !== checksum) {
      await rejectUpload(
        existing.id,
        existing.storageKey,
        'CHECKSUM_MISMATCH',
        new AppError('Uploaded checksum does not match', 400, 'INVALID_UPLOAD'),
      );
    }
    return checksum;
  }

  async function releasePending(id) {
    await db
      .update(attachments)
      .set({ status: 'pending' })
      .where(and(eq(attachments.id, id), eq(attachments.status, 'quarantined'), isNull(attachments.messageId)));
  }

  async function quarantinePending(id) {
    const [existing] = await db
      .update(attachments)
      .set({ status: 'quarantined' })
      .where(and(eq(attachments.id, id), eq(attachments.status, 'pending')))
      .returning();
    return existing;
  }

  return {
    publicAttachment,
    presentAttachments,
    async hydrate(message) {
      if (!message) return message;
      const files = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.messageId, message.id), eq(attachments.status, 'available')))
        .orderBy(asc(attachments.sortOrder), asc(attachments.createdAt));
      return { ...message, ...presentAttachments(files) };
    },
    async hydrateMany(rows) {
      if (!rows.length) return rows;
      const ids = rows.map((row) => row.id);
      const files = await db
        .select()
        .from(attachments)
        .where(and(inArray(attachments.messageId, ids), eq(attachments.status, 'available')))
        .orderBy(asc(attachments.sortOrder), asc(attachments.createdAt));
      const byMessage = new Map();
      for (const file of files) {
        const list = byMessage.get(file.messageId) || [];
        list.push(file);
        byMessage.set(file.messageId, list);
      }
      return rows.map((row) => ({ ...row, ...presentAttachments(byMessage.get(row.id) || []) }));
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
      if (pending >= MAX_PENDING_UPLOADS) throw new AppError('Too many unfinished uploads', 429, 'QUOTA_EXCEEDED');
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
      const existing = await quarantinePending(id);
      if (!existing) {
        const [again] = await db.select().from(attachments).where(eq(attachments.id, id));
        if (again?.status === 'available' && again.messageId) {
          const [message] = await db.select().from(messages).where(eq(messages.id, again.messageId));
          const hydrated = await this.hydrate(message);
          return { ...hydrated, duplicate: true };
        }
        throw new AppError('Upload is already being finalized', 409, 'CONFLICT');
      }
      try {
        const checksum = await completeUploadedObject(existing, input);
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
            await storage.remove(existing.storageKey).catch(() => {});
            const files = await tx
              .select()
              .from(attachments)
              .where(and(eq(attachments.messageId, created.message.id), eq(attachments.status, 'available')))
              .orderBy(asc(attachments.sortOrder), asc(attachments.createdAt));
            return {
              ...created.message,
              ...presentAttachments(files),
              duplicate: true,
            };
          }
          const [updated] = await tx
            .update(attachments)
            .set({
              status: 'available',
              checksumSha256: checksum,
              messageId: created.message.id,
              sortOrder: 0,
              finalizedAt: new Date(),
              uploadExpiresAt: null,
            })
            .where(eq(attachments.id, id))
            .returning();
          return { ...created.message, ...presentAttachments([updated]), duplicate: false };
        });
      } catch (error) {
        if (!(error instanceof AppError) || !['UNSUPPORTED_MEDIA_TYPE', 'INVALID_UPLOAD'].includes(error.code)) {
          await releasePending(id);
        }
        throw error;
      }
    },
    async completeBatch(conversationId, userId, input) {
      assertWritable();
      const { conversation, member } = await conversationsService.assertMember(conversationId, userId);
      assertGroupSend(conversation, member.role);
      const items = Array.isArray(input.items) ? input.items : [];
      if (items.length < 1 || items.length > MAX_ATTACHMENT_BATCH) {
        throw new AppError(`A batch can include 1 to ${MAX_ATTACHMENT_BATCH} files`, 400, 'VALIDATION_ERROR');
      }
      const ids = items.map((item) => item?.id).filter(Boolean);
      if (ids.length !== items.length || new Set(ids).size !== ids.length) {
        throw new AppError('Attachment ids are invalid', 400, 'VALIDATION_ERROR');
      }
      if (input.clientMessageId) {
        const [duplicate] = await db
          .select()
          .from(messages)
          .where(and(eq(messages.conversationId, conversationId), eq(messages.clientMessageId, input.clientMessageId)));
        if (duplicate) {
          const hydrated = await this.hydrate(duplicate);
          return { ...hydrated, duplicate: true };
        }
      }
      const rows = await db.select().from(attachments).where(inArray(attachments.id, ids));
      if (rows.length !== ids.length) throw new AppError('Attachment not found', 404, 'NOT_FOUND');
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const id of ids) {
        const row = byId.get(id);
        if (!row || row.uploaderId !== userId) throw new AppError('Attachment not found', 404, 'NOT_FOUND');
        if (row.conversationId !== conversationId) {
          throw new AppError('Attachment does not belong to this conversation', 400, 'INVALID_REFERENCE');
        }
        if (row.status === 'available' && row.messageId) {
          throw new AppError('Upload is not pending', 409, 'CONFLICT');
        }
        if (row.status !== 'pending') throw new AppError('Upload is not pending', 409, 'CONFLICT');
        if (row.uploadExpiresAt && row.uploadExpiresAt.getTime() < Date.now()) {
          throw new AppError('Upload expired', 410, 'UPLOAD_EXPIRED');
        }
      }
      const ready = [];
      const quarantinedIds = [];
      try {
        for (const [index, item] of items.entries()) {
          const existing = await quarantinePending(item.id);
          if (!existing) throw new AppError('Upload is already being finalized', 409, 'CONFLICT');
          quarantinedIds.push(existing.id);
          const checksum = await completeUploadedObject(existing, item);
          ready.push({ existing, checksum, sortOrder: index });
        }
        return db.transaction(async (tx) => {
          const created = await insertMessage(tx, {
            conversationId,
            userId,
            clientMessageId: input.clientMessageId,
            content: input.caption?.trim() ?? '',
            kind: batchMessageType(ready.map((item) => item.existing.kind)),
            replyToMessageId: input.replyToMessageId,
          });
          if (created.duplicate) {
            for (const item of ready) {
              await tx
                .update(attachments)
                .set({
                  status: 'deleted',
                  deletedAt: new Date(),
                  rejectionReason: 'duplicate_client_message',
                })
                .where(eq(attachments.id, item.existing.id));
              await storage.remove(item.existing.storageKey).catch(() => {});
            }
            const files = await tx
              .select()
              .from(attachments)
              .where(and(eq(attachments.messageId, created.message.id), eq(attachments.status, 'available')))
              .orderBy(asc(attachments.sortOrder), asc(attachments.createdAt));
            return { ...created.message, ...presentAttachments(files), duplicate: true };
          }
          const updated = [];
          for (const item of ready) {
            const [row] = await tx
              .update(attachments)
              .set({
                status: 'available',
                checksumSha256: item.checksum,
                messageId: created.message.id,
                sortOrder: item.sortOrder,
                finalizedAt: new Date(),
                uploadExpiresAt: null,
              })
              .where(eq(attachments.id, item.existing.id))
              .returning();
            updated.push(row);
          }
          return { ...created.message, ...presentAttachments(updated), duplicate: false };
        });
      } catch (error) {
        await Promise.all(quarantinedIds.map((id) => releasePending(id)));
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
      const fileName = displayFileName(row);
      const url = await storage.presignDownload(row.storageKey, {
        mimeType: row.mimeType,
        fileName,
        inline,
        expiresIn,
      });
      return {
        url,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        mimeType: row.mimeType,
        fileName,
        inline,
      };
    },
    async prepareZip(conversationId, userId, ids) {
      await conversationsService.assertMember(conversationId, userId);
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_ATTACHMENT_BATCH) {
        throw new AppError(`Select between 1 and ${MAX_ATTACHMENT_BATCH} files`, 400, 'VALIDATION_ERROR');
      }
      const orderedIds = [];
      const seen = new Set();
      for (const id of ids) {
        if (typeof id !== 'string' || seen.has(id)) continue;
        seen.add(id);
        orderedIds.push(id);
      }
      if (!orderedIds.length) throw new AppError('Select files to download', 400, 'VALIDATION_ERROR');
      const rows = await db.select().from(attachments).where(inArray(attachments.id, orderedIds));
      const byId = new Map(rows.map((row) => [row.id, row]));
      const ordered = [];
      for (const id of orderedIds) {
        const row = byId.get(id);
        if (
          !row ||
          row.conversationId !== conversationId ||
          row.status !== 'available' ||
          row.deletedAt
        ) {
          throw new AppError('Attachment not found', 403, 'FORBIDDEN');
        }
        if (row.messageId) {
          const [message] = await db.select().from(messages).where(eq(messages.id, row.messageId));
          if (!message || message.deletedAt) throw new AppError('Attachment not found', 403, 'FORBIDDEN');
        }
        ordered.push(row);
      }
      const totalBytes = ordered.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0);
      if (totalBytes > MAX_ZIP_BYTES) {
        throw new AppError('Selected files are too large to zip', 413, 'PAYLOAD_TOO_LARGE');
      }
      const names = uniqueDisplayNames(ordered);
      return {
        archiveName: archiveFileName(),
        totalBytes,
        files: ordered.map((row, index) => ({
          id: row.id,
          storageKey: row.storageKey,
          sizeBytes: row.sizeBytes,
          mimeType: row.mimeType,
          entryName: names[index],
        })),
      };
    },
    async openZipStream(conversationId, userId, ids) {
      const prepared = await this.prepareZip(conversationId, userId, ids);
      const output = zipOutputStream();
      const streaming = streamZipArchive(output, prepared.files, (key) => storage.getObjectStream(key)).catch(
        (error) => {
          if (!output.destroyed) output.destroy(error);
          throw error;
        },
      );
      return {
        ...prepared,
        output,
        streaming,
        contentDisposition: contentDispositionAttachment(prepared.archiveName),
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
          const remaining = await tx
            .select({ id: attachments.id })
            .from(attachments)
            .where(
              and(
                eq(attachments.messageId, row.messageId),
                eq(attachments.status, 'available'),
                ne(attachments.id, id),
              ),
            );
          if (remaining.length === 0) {
            [message] = await tx
              .update(messages)
              .set({ deletedAt: new Date(), content: '', changeSeq: c.lastChangeSeq })
              .where(and(eq(messages.id, row.messageId), isNull(messages.deletedAt)))
              .returning();
          }
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
      const files = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.messageId, source.id), eq(attachments.status, 'available')))
        .orderBy(asc(attachments.sortOrder), asc(attachments.createdAt));
      if (!files.length) throw new AppError('Referenced message unavailable', 400, 'INVALID_REFERENCE');
      const copies = [];
      for (const file of files) {
        const storageKey = createStorageKey();
        await storage.copyObject(file.storageKey, storageKey);
        copies.push({ file, storageKey });
      }
      return db.transaction(async (tx) => {
        const created = await insertMessage(tx, {
          conversationId: input.conversationId,
          userId,
          clientMessageId: input.clientMessageId,
          content: source.content,
          kind: batchMessageType(files.map((file) => file.kind)),
          replyToMessageId: undefined,
        });
        if (created.duplicate) {
          for (const copy of copies) await storage.remove(copy.storageKey).catch(() => {});
          const existing = await tx
            .select()
            .from(attachments)
            .where(and(eq(attachments.messageId, created.message.id), eq(attachments.status, 'available')))
            .orderBy(asc(attachments.sortOrder), asc(attachments.createdAt));
          return {
            ...created.message,
            forwardedFromMessageId: created.message.forwardedFromMessageId || source.id,
            ...presentAttachments(existing),
            duplicate: true,
          };
        }
        const copied = [];
        for (const [index, copy] of copies.entries()) {
          const [row] = await tx
            .insert(attachments)
            .values({
              conversationId: input.conversationId,
              uploaderId: userId,
              messageId: created.message.id,
              storageKey: copy.storageKey,
              originalName: copy.file.originalName,
              mimeType: copy.file.mimeType,
              sizeBytes: copy.file.sizeBytes,
              checksumSha256: copy.file.checksumSha256,
              kind: copy.file.kind,
              sortOrder: index,
              status: 'available',
              finalizedAt: new Date(),
            })
            .returning();
          copied.push(row);
        }
        await tx
          .update(messages)
          .set({ forwardedFromMessageId: source.id })
          .where(eq(messages.id, created.message.id));
        return {
          ...created.message,
          forwardedFromMessageId: source.id,
          ...presentAttachments(copied),
          duplicate: false,
        };
      });
    },
  };
}
