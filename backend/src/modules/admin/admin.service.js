import { and, eq, isNull } from 'drizzle-orm';
import { users } from '../../database/schema/index.js';
import { hashPassword, temporaryPassword } from '../../services/password.service.js';
import { normalizePhone } from '../../services/phone.js';
import { profilePhotoService } from '../../services/profile-photo.service.js';
import { AppError } from '../../utils/app-error.js';
import { audit, revokeSessions } from '../auth/auth.repository.js';
import { activeAdminCount, auditPage, employeePage } from './admin.repository.js';

function phonePatch(value) {
  if (value === undefined) return {};
  if (value === null || value === '') return { phoneE164: null, phoneVerifiedAt: null };
  return { phoneE164: normalizePhone(value), phoneVerifiedAt: null };
}

export function adminService(app, config) {
  const db = app.database.db;
  const photos = profilePhotoService(app, config);
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
      const password = input.password || temporaryPassword();
      const passwordHash = await hashPassword(password);
      const user = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            employeeCode: input.employeeCode ?? null,
            username: input.username,
            displayName: input.displayName,
            fullName: input.fullName || input.displayName,
            email: input.email ?? null,
            address: input.address ?? null,
            passwordHash,
            role: input.role ?? 'user',
            createdBy: context.userId,
            ...phonePatch(input.phone),
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
        const [target] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, id), isNull(users.deletedAt)))
          .for('update');
        if (!target) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        if (input.role && input.role !== 'admin') {
          await disallowLastAdmin(tx, target, target.role === 'admin');
        }
        const { phone, ...rest } = input;
        const [updated] = await tx
          .update(users)
          .set({ ...rest, ...phonePatch(phone), updatedAt: new Date() })
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
    async resetPassword(id, input, context) {
      const password = input?.password || temporaryPassword();
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
    async remove(id, context) {
      const result = await db.transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, id), isNull(users.deletedAt)))
          .for('update');
        if (!target) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        if (target.id === context.userId) {
          throw new AppError('Administrators cannot delete their own account', 403, 'CANNOT_DELETE_SELF');
        }
        if (target.role !== 'user') {
          throw new AppError(
            'Administrators cannot delete other administrators',
            403,
            'CANNOT_DELETE_ADMIN',
          );
        }
        const token = target.id.replace(/-/g, '').slice(0, 8);
        const [user] = await tx
          .update(users)
          .set({
            username: `deleted.${token}`,
            displayName: 'Deleted employee',
            fullName: 'Deleted employee',
            email: null,
            phoneE164: null,
            phoneVerifiedAt: null,
            address: null,
            employeeCode: null,
            profilePhotoKey: null,
            status: 'suspended',
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(users.id, id), isNull(users.deletedAt)))
          .returning();
        if (!user) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        const sessions = await revokeSessions(tx, id, 'account_deleted');
        await audit(tx, context, 'admin.user_deleted', 'user', id);
        return { user, sessions, photoKey: target.profilePhotoKey };
      });
      app.sessionEvents.emit('revoked', {
        sessionIds: result.sessions.map((s) => s.id),
        reason: 'account_deleted',
      });
      for (const userId of app.connections.closeUser(id, 'account_deleted')) {
        app.broadcaster.presence(userId, false).catch(() =>
          app.log.warn({ userId }, 'Unable to broadcast offline presence'),
        );
      }
      if (result.photoKey) await app.storage.remove(result.photoKey).catch(() => {});
      return { success: true };
    },
    initPhoto: (id, mimeType) => photos.init(id, mimeType),
    async completePhoto(id, key, mimeType, context) {
      const target = await this.get(id);
      const user = await photos.complete(target.id, key, mimeType);
      await audit(app.database.db, context, 'admin.user_updated', 'user', id, {
        fields: ['profilePhotoKey'],
      });
      return user;
    },
    async removePhoto(id, context) {
      const target = await this.get(id);
      const user = await photos.remove(target.id);
      await audit(app.database.db, context, 'admin.user_updated', 'user', id, {
        fields: ['profilePhotoKey'],
      });
      return user;
    },
  };
}
