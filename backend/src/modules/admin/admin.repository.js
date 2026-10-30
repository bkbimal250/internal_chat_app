import { and, asc, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { auditLogs, users } from '../../database/schema/index.js';

export const nonDeleted = isNull(users.deletedAt);
export const searchUsers = (term) =>
  term
    ? or(
        ilike(users.username, `%${term}%`),
        ilike(users.displayName, `%${term}%`),
        ilike(users.employeeCode, `%${term}%`),
      )
    : undefined;
export async function employeePage(db, { page, limit, search }) {
  const where = and(nonDeleted, searchUsers(search));
  const [total] = await db.select({ total: count() }).from(users).where(where);
  const data = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(asc(users.username))
    .limit(limit)
    .offset((page - 1) * limit);
  return { data, page, limit, total: Number(total.total) };
}
export async function activeAdminCount(tx) {
  const [row] = await tx
    .select({ count: sql`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), nonDeleted));
  return row.count;
}
export async function auditPage(db, { page, limit }) {
  const [total] = await db.select({ total: count() }).from(auditLogs);
  const data = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      actorUserId: auditLogs.actorUserId,
      actorSessionId: auditLogs.actorSessionId,
      ipAddress: auditLogs.ipAddress,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);
  return { data, page, limit, total: Number(total.total) };
}
