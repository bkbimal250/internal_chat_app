import { and, asc, count, eq, ilike, isNull, or } from 'drizzle-orm';
import { users } from '../../database/schema/index.js';
export const visible = and(eq(users.status, 'active'), isNull(users.deletedAt));
export async function directory(db, { page, limit, search }) {
  const term = String(search || '')
    .trim()
    .replace(/^@/, '');
  const like = term ? `%${term}%` : undefined;
  const phoneLike = term ? `%${term.replace(/[\s-]/g, '')}%` : undefined;
  const filter = like
    ? or(
        ilike(users.username, like),
        ilike(users.displayName, like),
        ilike(users.fullName, like),
        ilike(users.employeeCode, like),
        ilike(users.phoneE164, phoneLike),
      )
    : undefined;
  const where = and(visible, filter);
  const [row] = await db.select({ total: count() }).from(users).where(where);
  const data = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(asc(users.displayName))
    .limit(limit)
    .offset((page - 1) * limit);
  return { data, page, limit, total: Number(row.total) };
}
