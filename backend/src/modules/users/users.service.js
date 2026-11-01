import { and, eq, isNull } from 'drizzle-orm';
import { users } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { normalizePhone } from '../../services/phone.js';
import { profilePhotoService } from '../../services/profile-photo.service.js';
import { directory } from './users.repository.js';

function phonePatch(value) {
  if (value === undefined) return {};
  if (value === null || value === '') return { phoneE164: null, phoneVerifiedAt: null };
  return { phoneE164: normalizePhone(value), phoneVerifiedAt: new Date() };
}

export function usersService(app, config) {
  const db = app.database.db;
  const photos = profilePhotoService(app, config);
  return {
    directory: (query) => directory(db, query),
    async public(id) {
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.status, 'active'), isNull(users.deletedAt)));
      if (!user) throw new AppError('Employee not found', 404, 'NOT_FOUND');
      return user;
    },
    async updateMe(id, input) {
      const { phone, ...rest } = input;
      const [user] = await db
        .update(users)
        .set({ ...rest, ...phonePatch(phone), updatedAt: new Date() })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning();
      if (!user) throw new AppError('Employee not found', 404, 'NOT_FOUND');
      return user;
    },
    initPhoto: (id, mimeType) => photos.init(id, mimeType),
    completePhoto: (id, key, mimeType) => photos.complete(id, key, mimeType),
    removePhoto: (id) => photos.remove(id),
    photoUrl: (user) => photos.url(user),
  };
}
