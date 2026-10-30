import { eq } from 'drizzle-orm';
import { users } from '../schema/index.js';
import { hashPassword } from '../../services/password.service.js';
import { audit, findByUsername, revokeSessions } from '../../modules/auth/auth.repository.js';

const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;

export function assertRecoveryPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw new Error(`Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters`);
  }
}

export async function recoverAdministrator(db, { username, password }) {
  const target = String(username ?? '').trim();
  if (!target) throw new Error('Administrator username is required');
  assertRecoveryPassword(password);
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const user = await findByUsername(tx, target);
    if (!user || user.deletedAt || user.role !== 'admin') {
      throw new Error('Administrator not found');
    }
    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    const revoked = await revokeSessions(tx, user.id, 'admin_recovery');
    await audit(
      tx,
      { userId: null, sessionId: null, ip: null },
      'ops.admin_recovered',
      'user',
      user.id,
      { reason: 'operator_cli', count: revoked.length, fields: ['password', 'sessions'] },
    );
    return {
      userId: user.id,
      username: user.username,
      status: user.status,
      revoked: revoked.length,
    };
  });
}
