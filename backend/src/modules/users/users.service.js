import { and, eq, isNull } from 'drizzle-orm';
import { users } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { directory } from './users.repository.js';
export function usersService(app) {
  const db = app.database.db;
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
      const [user] = await db
        .update(users)
        .set({ displayName: input.displayName, updatedAt: new Date() })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning();
      if (!user) throw new AppError('Employee not found', 404, 'NOT_FOUND');
      return user;
    },
  };
}
