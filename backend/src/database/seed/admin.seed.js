import { and, eq, isNull, sql } from 'drizzle-orm';
import { users } from '../schema/index.js';
import { hashPassword } from '../../services/password.service.js';

export async function bootstrapAdmin(db, values) {
  const existing = await db
    .select({ count: sql`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.deletedAt)));
  if (existing[0].count > 0) return { created: false };
  if (!values.username || !values.password || !values.displayName)
    throw new Error('Bootstrap administrator credentials are required');
  const passwordHash = await hashPassword(values.password);
  try {
    const [user] = await db
      .insert(users)
      .values({
        username: values.username,
        displayName: values.displayName,
        fullName: values.displayName,
        passwordHash,
        role: 'admin',
        mustChangePassword: true,
      })
      .returning({ id: users.id });
    return { created: true, userId: user.id };
  } catch (error) {
    if (error.code === '23505') return { created: false };
    throw error;
  }
}
