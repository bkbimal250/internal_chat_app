import { and, eq, isNull } from 'drizzle-orm';
import { users } from '../../database/schema/index.js';
import { hashPassword, temporaryPassword } from '../../services/password.service.js';
import { AppError } from '../../utils/app-error.js';
import { audit, revokeSessions } from '../auth/auth.repository.js';
import { activeAdminCount, auditPage, employeePage } from './admin.repository.js';

export function adminService(app) {
  const db = app.database.db;
  const disallowLastAdmin = async (tx, target, change) => {
    if (target.role === 'admin' && target.status === 'active' && change) {
      if ((await activeAdminCount(tx)) <= 1)
        throw new AppError('Cannot disable the last active administrator', 409, 'LAST_ADMIN');
    }
  };
  return {
    list: (query) => employeePage(db, query),
    audit: (query) => auditPage(db, query),
    async get(id) {
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)));
      if (!user) throw new AppError('Employee not found', 404, 'NOT_FOUND');
      return user;
    },
    async create(input, context) {
      const password = temporaryPassword();
      const passwordHash = await hashPassword(password);
      const user = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            employeeCode: input.employeeCode ?? null,
            username: input.username,
            displayName: input.displayName,
            email: input.email ?? null,
            passwordHash,
            role: input.role ?? 'user',
            createdBy: context.userId,
          })
          .returning();
        await audit(tx, context, 'admin.user_created', 'user', created.id, {
          fields: ['employeeCode', 'username', 'role'],
        });
        return created;
      });
      return { user, temporaryPassword: password };
    },
    async update(id, input, context) {
      const user = await db.transaction(async (tx) => {
        const target = await this.get(id);
        const [updated] = await tx
          .update(users)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(users.id, target.id))
          .returning();
        await audit(tx, context, 'admin.user_updated', 'user', id, { fields: Object.keys(input) });
        return updated;
      });
      return user;
    },
    async setStatus(id, status, context) {
      const result = await db.transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, id), isNull(users.deletedAt)))
          .for('update');
        if (!target) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        await disallowLastAdmin(tx, target, status === 'suspended');
        const [user] = await tx
          .update(users)
          .set({ status, updatedAt: new Date() })
          .where(eq(users.id, id))
          .returning();
        const sessions =
          status === 'suspended' ? await revokeSessions(tx, id, 'account_suspended') : [];
        await audit(
          tx,
          context,
          status === 'suspended' ? 'admin.user_suspended' : 'admin.user_reactivated',
          'user',
          id,
        );
        return { user, sessions };
      });
      if (result.sessions.length)
        app.sessionEvents.emit('revoked', {
          sessionIds: result.sessions.map((s) => s.id),
          reason: 'account_suspended',
        });
      return result.user;
    },
    async resetPassword(id, context) {
      const password = temporaryPassword();
      const passwordHash = await hashPassword(password);
      const result = await db.transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, id), isNull(users.deletedAt)))
          .for('update');
        if (!target) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        const [user] = await tx
          .update(users)
          .set({
            passwordHash,
            mustChangePassword: true,
            passwordChangedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, id))
          .returning();
        const sessions = await revokeSessions(tx, id, 'password_reset');
        await audit(tx, context, 'admin.password_reset', 'user', id);
        return { user, sessions };
      });
      app.sessionEvents.emit('revoked', {
        sessionIds: result.sessions.map((s) => s.id),
        reason: 'password_reset',
      });
      return { user: result.user, temporaryPassword: password };
    },
    async revokeAll(id, context) {
      const rows = await db.transaction(async (tx) => {
        const target = await this.get(id);
        const result = await revokeSessions(tx, target.id, 'admin_revoked');
        await audit(tx, context, 'admin.sessions_revoked', 'user', target.id, {
          count: result.length,
        });
        return result;
      });
      app.sessionEvents.emit('revoked', {
        sessionIds: rows.map((s) => s.id),
        reason: 'admin_revoked',
      });
      return rows.length;
    },
  };
}
