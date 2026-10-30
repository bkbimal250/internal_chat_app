import { and, isNull, lt } from 'drizzle-orm';
import { consumedRefreshTokens, sessions } from '../database/schema/index.js';

export async function cleanupSessions(database) {
  await database.db.transaction(async (tx) => {
    await tx.delete(consumedRefreshTokens).where(lt(consumedRefreshTokens.expiresAt, new Date()));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date(), revocationReason: 'expired' })
      .where(and(isNull(sessions.revokedAt), lt(sessions.expiresAt, new Date())));
  });
}
