import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { devices, sessions } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { audit, revokeSessions } from '../auth/auth.repository.js';
export function sessionsService(app) {
  const db = app.database.db;
  return {
    async list(userId) {
      return db
        .select({
          id: sessions.id,
          deviceId: sessions.deviceId,
          deviceName: devices.deviceName,
          platform: devices.platform,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(
          and(
            eq(sessions.userId, userId),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(sessions.lastUsedAt));
    },
    async revoke(userId, sessionId, context) {
      const rows = await db.transaction(async (tx) => {
        const [found] = await tx
          .select()
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
        if (!found) throw new AppError('Session not found', 404, 'NOT_FOUND');
        const result = await revokeSessions(tx, userId, 'user_revoked', sessionId);
        await audit(tx, context, 'session.revoked', 'session', sessionId);
        return result;
      });
      app.sessionEvents.emit('revoked', {
        sessionIds: rows.map((s) => s.id),
        reason: 'user_revoked',
      });
    },
    async cleanup() {
      await db.execute(sql`delete from consumed_refresh_tokens where expires_at <= now()`);
    },
  };
}
