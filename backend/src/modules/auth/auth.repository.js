import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { users, sessions, auditLogs } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';

export const activeSessions = (userId) =>
  and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()));
export const usableUser = (user) => user && user.status === 'active' && !user.deletedAt;
export const invalidCredentials = () =>
  new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
export const invalidSession = () => new AppError('Authentication required', 401, 'UNAUTHORIZED');
export async function lockUser(tx, id) {
  const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update');
  return user;
}
export async function findByUsername(db, username) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${username.toLowerCase()}`);
  return user;
}
export function publicUser(user) {
  return {
    id: user.id,
    employeeCode: user.employeeCode,
    username: user.username,
    displayName: user.displayName,
    fullName: user.fullName || user.displayName,
    email: user.email,
    phoneE164: user.phoneE164 ?? null,
    phoneVerifiedAt: user.phoneVerifiedAt ?? null,
    address: user.address ?? null,
    hasProfilePhoto: Boolean(user.profilePhotoKey),
    profilePhotoUrl: user.profilePhotoUrl ?? null,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
export async function audit(tx, context, action, targetType, targetId = null, metadata = {}) {
  // Only explicit system-generated fields are allowed in audit metadata.
  const safe = {};
  for (const key of ['reason', 'count', 'platform', 'fields', 'method']) {
    if (metadata[key] !== undefined) safe[key] = metadata[key];
  }
  await tx.insert(auditLogs).values({
    actorUserId: context?.userId ?? null,
    actorSessionId: context?.sessionId ?? null,
    ipAddress: context?.ip ?? null,
    action,
    targetType,
    targetId,
    metadata: safe,
  });
}
export async function revokeSessions(tx, userId, reason, sessionId) {
  return tx
    .update(sessions)
    .set({ revokedAt: new Date(), revocationReason: reason })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        sessionId ? eq(sessions.id, sessionId) : undefined,
      ),
    )
    .returning({ id: sessions.id });
}
