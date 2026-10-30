import { and, eq, sql } from 'drizzle-orm';
import { devices, sessions, users, consumedRefreshTokens } from '../../database/schema/index.js';
import { hashPassword, verifyPassword, getDummyHash } from '../../services/password.service.js';
import { newRefreshToken, hashToken } from '../../services/token.service.js';
import { AppError } from '../../utils/app-error.js';
import {
  activeSessions,
  audit,
  findByUsername,
  invalidCredentials,
  invalidSession,
  lockUser,
  revokeSessions,
  usableUser,
} from './auth.repository.js';

export function authService(app, config) {
  const db = app.database.db;
  return {
    async login(input, context) {
      const candidate = await findByUsername(db, input.username);
      const valid = await verifyPassword(
        candidate?.passwordHash ?? (await getDummyHash()),
        input.password,
      );
      if (!valid || !usableUser(candidate)) {
        await audit(db, { ip: context.ip }, 'auth.login_failed', 'user');
        throw invalidCredentials();
      }
      const token = newRefreshToken();
      return db.transaction(async (tx) => {
        const user = await lockUser(tx, candidate.id);
        if (!usableUser(user) || user.passwordHash !== candidate.passwordHash)
          throw invalidCredentials();
        const [{ count }] = await tx
          .select({ count: sql`count(*)::int` })
          .from(sessions)
          .where(activeSessions(user.id));
        if (count >= 50)
          throw new AppError('Maximum active sessions reached', 409, 'SESSION_LIMIT');
        let device;
        if (input.deviceId) {
          [device] = await tx
            .select()
            .from(devices)
            .where(and(eq(devices.id, input.deviceId), eq(devices.userId, user.id)));
          if (!device || device.platform !== input.platform)
            throw new AppError('Invalid device', 400, 'INVALID_DEVICE');
          [device] = await tx
            .update(devices)
            .set({ deviceName: input.deviceName, lastSeenAt: new Date() })
            .where(eq(devices.id, device.id))
            .returning();
        } else {
          [device] = await tx
            .insert(devices)
            .values({
              userId: user.id,
              deviceName: input.deviceName,
              platform: input.platform,
            })
            .returning();
        }
        const [session] = await tx
          .insert(sessions)
          .values({
            userId: user.id,
            deviceId: device.id,
            refreshTokenHash: hashToken(token),
            transport: input.clientType,
            expiresAt: new Date(Date.now() + config.refreshTokenDays * 86400000),
          })
          .returning();
        await audit(
          tx,
          { ...context, userId: user.id, sessionId: session.id },
          'auth.login',
          'session',
          session.id,
          { platform: device.platform },
        );
        return { user, session, token };
      });
    },
    async refresh(token, transport, context) {
      const digest = hashToken(token);
      let [candidate] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.refreshTokenHash, digest));
      if (!candidate) {
        const [used] = await db
          .select()
          .from(consumedRefreshTokens)
          .where(eq(consumedRefreshTokens.tokenHash, digest));
        if (used)
          [candidate] = await db.select().from(sessions).where(eq(sessions.id, used.sessionId));
      }
      if (!candidate) throw invalidSession();
      const result = await db.transaction(async (tx) => {
        const user = await lockUser(tx, candidate.userId);
        const [session] = await tx.select().from(sessions).where(eq(sessions.id, candidate.id));
        if (session.transport !== transport) return { invalid: true };
        if (session.refreshTokenHash !== digest) {
          const [used] = await tx
            .select()
            .from(consumedRefreshTokens)
            .where(
              and(
                eq(consumedRefreshTokens.tokenHash, digest),
                eq(consumedRefreshTokens.sessionId, session.id),
              ),
            );
          if (!used) return { invalid: true };
          await revokeSessions(tx, user.id, 'refresh_reuse', session.id);
          await audit(
            tx,
            { ...context, userId: user.id, sessionId: session.id },
            'auth.refresh_reuse',
            'session',
            session.id,
          );
          return { invalid: true, revoked: session.id };
        }
        if (!usableUser(user) || session.revokedAt || session.expiresAt <= new Date())
          return { invalid: true };
        const next = newRefreshToken();
        await tx.insert(consumedRefreshTokens).values({
          tokenHash: digest,
          sessionId: session.id,
          expiresAt: session.expiresAt,
        });
        const [rotated] = await tx
          .update(sessions)
          .set({ refreshTokenHash: hashToken(next), lastUsedAt: new Date() })
          .where(eq(sessions.id, session.id))
          .returning();
        await tx
          .update(devices)
          .set({ lastSeenAt: new Date() })
          .where(eq(devices.id, session.deviceId));
        await audit(
          tx,
          { ...context, userId: user.id, sessionId: session.id },
          'auth.refresh',
          'session',
          session.id,
        );
        return { user, session: rotated, token: next };
      });
      if (result.revoked)
        app.sessionEvents.emit('revoked', {
          sessionIds: [result.revoked],
          reason: 'refresh_reuse',
        });
      if (result.invalid) throw invalidSession();
      return result;
    },
    async logout(context, all = false) {
      const revoked = await db.transaction(async (tx) => {
        await lockUser(tx, context.userId);
        const rows = await revokeSessions(
          tx,
          context.userId,
          all ? 'logout_all' : 'logout',
          all ? undefined : context.sessionId,
        );
        await audit(tx, context, all ? 'auth.logout_all' : 'auth.logout', 'user', context.userId);
        return rows;
      });
      app.sessionEvents.emit('revoked', { sessionIds: revoked.map((s) => s.id), reason: 'logout' });
    },
    async changePassword(context, input) {
      const candidate = await db
        .select()
        .from(users)
        .where(eq(users.id, context.userId))
        .then(([u]) => u);
      if (!candidate || !(await verifyPassword(candidate.passwordHash, input.currentPassword)))
        throw invalidCredentials();
      if (input.currentPassword === input.newPassword)
        throw new AppError('Choose a different password', 400, 'PASSWORD_UNCHANGED');
      const passwordHash = await hashPassword(input.newPassword);
      const revoked = await db.transaction(async (tx) => {
        const user = await lockUser(tx, context.userId);
        if (!usableUser(user) || user.passwordHash !== candidate.passwordHash)
          throw invalidSession();
        await tx
          .update(users)
          .set({
            passwordHash,
            mustChangePassword: false,
            passwordChangedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
        const rows = await revokeSessions(tx, user.id, 'password_change');
        await audit(tx, context, 'auth.password_changed', 'user', user.id);
        return rows;
      });
      app.sessionEvents.emit('revoked', {
        sessionIds: revoked.map((s) => s.id),
        reason: 'password_change',
      });
    },
  };
}
