import { and, asc, count, eq, ilike, isNull, or } from 'drizzle-orm';
import { users } from '../../database/schema/index.js';
export const visible = and(eq(users.status, 'active'), isNull(users.deletedAt));
export async function directory(db, { page, limit, search }) {
  const filter = search
    ? or(
        ilike(users.username, `%${search}%`),
        ilike(users.displayName, `%${search}%`),
        ilike(users.employeeCode, `%${search}%`),
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
