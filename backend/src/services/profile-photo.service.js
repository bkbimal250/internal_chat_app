import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { users } from '../database/schema/index.js';
import { assertDeclaredType, inspectContent } from './file-kind.js';
import { AppError } from '../utils/app-error.js';

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const THUMB_SIZE = 256;

export function avatarKey(userId) {
  return `avatars/${userId}/${randomBytes(16).toString('hex')}`;
}

function photoMime(key) {
  if (String(key).endsWith('.png')) return 'image/png';
  if (String(key).endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function photoFileName(key) {
  if (String(key).endsWith('.png')) return 'avatar.png';
  if (String(key).endsWith('.webp')) return 'avatar.webp';
  return 'avatar.jpg';
}

function photoVersion(user) {
  return user?.updatedAt instanceof Date ? user.updatedAt.toISOString() : (user?.updatedAt ?? null);
}

export function profilePhotoService(app, config) {
  const db = app.database.db;
  const storage = app.storage;
  const assertOwnerKey = (userId, key) => {
    if (!key || !key.startsWith(`avatars/${userId}/`) || key.includes('..')) {
      throw new AppError('Invalid photo upload', 400, 'INVALID_UPLOAD');
    }
  };

  const notify = async (user) => {
    if (!app.broadcaster?.profile) return;
    await app.broadcaster.profile(user.id, {
      userId: user.id,
      hasProfilePhoto: Boolean(user.profilePhotoKey),
      photoVersion: photoVersion(user),
    });
  };

  return {
    async init(userId, mimeType) {
      if (!PHOTO_TYPES.has(mimeType)) {
        throw new AppError('Profile photos must be JPEG, PNG, or WebP', 415, 'UNSUPPORTED_MEDIA_TYPE');
      }
      assertDeclaredType(mimeType, PHOTO_MAX_BYTES);
      const key = avatarKey(userId);
      const uploadUrl = await storage.presignUpload(key, mimeType, config.s3UploadTtlSeconds);
      return { uploadUrl, key, expiresIn: config.s3UploadTtlSeconds, headers: { 'Content-Type': mimeType } };
    },

    async complete(userId, key, mimeType) {
      assertOwnerKey(userId, key);
      if (!PHOTO_TYPES.has(mimeType)) {
        throw new AppError('Profile photos must be JPEG, PNG, or WebP', 415, 'UNSUPPORTED_MEDIA_TYPE');
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
      const thumbKey = `${avatarKey(userId)}.webp`;
      await storage.putObject(thumbKey, thumbnail, 'image/webp');
      const [current] = await db
        .select({ profilePhotoKey: users.profilePhotoKey })
        .from(users)
        .where(eq(users.id, userId));
      const [user] = await db
        .update(users)
        .set({ profilePhotoKey: thumbKey, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      if (current?.profilePhotoKey && current.profilePhotoKey !== thumbKey && current.profilePhotoKey !== key) {
        await storage.remove(current.profilePhotoKey).catch(() => {});
      }
      if (key !== thumbKey) await storage.remove(key).catch(() => {});
      await notify(user).catch(() => {});
      return user;
    },

    async remove(userId) {
      const [current] = await db.select().from(users).where(eq(users.id, userId));
      if (!current) throw new AppError('Employee not found', 404, 'NOT_FOUND');
      if (!current.profilePhotoKey) return current;
      const [user] = await db
        .update(users)
        .set({ profilePhotoKey: null, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      await storage.remove(current.profilePhotoKey).catch(() => {});
      await notify(user).catch(() => {});
      return user;
    },

    async url(user) {
      if (!user?.profilePhotoKey) return null;
      return storage.presignDownload(user.profilePhotoKey, {
        mimeType: photoMime(user.profilePhotoKey),
        fileName: photoFileName(user.profilePhotoKey),
        inline: true,
        expiresIn: config.s3DownloadTtlSeconds,
      });
    },
  };
}
