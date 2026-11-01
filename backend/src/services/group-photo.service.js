import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import { conversations } from '../database/schema/index.js';
import { assertDeclaredType, inspectContent } from './file-kind.js';
import { AppError } from '../utils/app-error.js';

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const THUMB_SIZE = 256;

export function groupAvatarKey(groupId) {
  return `avatars/groups/${groupId}/${randomBytes(16).toString('hex')}`;
}

function photoMime(key) {
  if (String(key).endsWith('.png')) return 'image/png';
  if (String(key).endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export function groupPhotoService(app, config) {
  const db = app.database.db;
  const storage = app.storage;

  const assertOwnerKey = (groupId, key) => {
    if (!key || !key.startsWith(`avatars/groups/${groupId}/`) || key.includes('..')) {
      throw new AppError('Invalid photo upload', 400, 'INVALID_UPLOAD');
    }
  };

  return {
    async init(groupId, mimeType) {
      if (!PHOTO_TYPES.has(mimeType)) {
        throw new AppError('Group photos must be JPEG, PNG, or WebP', 415, 'UNSUPPORTED_MEDIA_TYPE');
      }
      assertDeclaredType(mimeType, PHOTO_MAX_BYTES);
      const key = groupAvatarKey(groupId);
      const uploadUrl = await storage.presignUpload(key, mimeType, config.s3UploadTtlSeconds);
      return { uploadUrl, key, expiresIn: config.s3UploadTtlSeconds, headers: { 'Content-Type': mimeType } };
    },

    async complete(groupId, key, mimeType) {
      assertOwnerKey(groupId, key);
      if (!PHOTO_TYPES.has(mimeType)) {
        throw new AppError('Group photos must be JPEG, PNG, or WebP', 415, 'UNSUPPORTED_MEDIA_TYPE');
      }
      const head = await storage.head(key);
      if (!head) throw new AppError('Uploaded object was not found', 400, 'INVALID_UPLOAD');
      const size = Number(head.ContentLength ?? 0);
      if (!Number.isInteger(size) || size < 1 || size > PHOTO_MAX_BYTES) {
        await storage.remove(key);
        throw new AppError('File is too large', 413, 'PAYLOAD_TOO_LARGE');
      }
      const buffer = await storage.getObjectBuffer(key, PHOTO_MAX_BYTES);
      await inspectContent(buffer, mimeType);
      let thumbnail;
      try {
        thumbnail = await sharp(buffer)
          .rotate()
          .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
          .webp({ quality: 82 })
          .toBuffer();
      } catch {
        await storage.remove(key).catch(() => {});
        throw new AppError('Unable to process image', 400, 'INVALID_UPLOAD');
      }
      const thumbKey = `${groupAvatarKey(groupId)}.webp`;
      await storage.putObject(thumbKey, thumbnail, 'image/webp');
      const [current] = await db
        .select({ avatarReference: conversations.avatarReference })
        .from(conversations)
        .where(and(eq(conversations.id, groupId), eq(conversations.type, 'group')));
      const [conversation] = await db
        .update(conversations)
        .set({ avatarReference: thumbKey, updatedAt: new Date() })
        .where(eq(conversations.id, groupId))
        .returning();
      if (current?.avatarReference && current.avatarReference !== thumbKey && current.avatarReference !== key) {
        await storage.remove(current.avatarReference).catch(() => {});
      }
      if (key !== thumbKey) await storage.remove(key).catch(() => {});
      return conversation;
    },

    async remove(groupId) {
      const [current] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, groupId), eq(conversations.type, 'group')));
      if (!current) throw new AppError('Group not found', 404, 'NOT_FOUND');
      if (!current.avatarReference) return current;
      const [conversation] = await db
        .update(conversations)
        .set({ avatarReference: null, updatedAt: new Date() })
        .where(eq(conversations.id, groupId))
        .returning();
      await storage.remove(current.avatarReference).catch(() => {});
      return conversation;
    },

    async url(conversation) {
      if (!conversation?.avatarReference) return null;
      return storage.presignDownload(conversation.avatarReference, {
        mimeType: photoMime(conversation.avatarReference),
        fileName: 'group.webp',
        inline: true,
        expiresIn: config.s3DownloadTtlSeconds,
      });
    },
  };
}
