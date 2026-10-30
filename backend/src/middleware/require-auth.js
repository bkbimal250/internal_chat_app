import { and, eq, gt, isNull } from 'drizzle-orm';
import { sessions, users, devices } from '../database/schema/index.js';
import { invalidSession } from '../modules/auth/auth.repository.js';
import { AppError } from '../utils/app-error.js';

export function requireAuth(app, { allowPasswordChange = false } = {}) {
  return async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      throw invalidSession();
    }
    const { sub, sid } = request.user;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof sub !== 'string' || typeof sid !== 'string' || !uuid.test(sub) || !uuid.test(sid))
      throw invalidSession();
    const [row] = await app.database.db
      .select({ user: users, session: sessions })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.id, sid),
          eq(users.id, sub),
          eq(users.status, 'active'),
          isNull(users.deletedAt),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      );
    if (!row) throw invalidSession();
    request.auth = {
      user: row.user,
      session: row.session,
      userId: sub,
      sessionId: sid,
      ip: request.ip,
    };
    if (row.user.mustChangePassword && !allowPasswordChange) {
      throw new AppError('Password change required', 403, 'PASSWORD_CHANGE_REQUIRED');
    }
    if (row.session.lastUsedAt < new Date(Date.now() - 60000)) {
      await app.database.db
        .update(sessions)
        .set({ lastUsedAt: new Date() })
        .where(eq(sessions.id, sid));
      await app.database.db
        .update(devices)
        .set({ lastSeenAt: new Date() })
        .where(eq(devices.id, row.session.deviceId));
    }
  };
}
