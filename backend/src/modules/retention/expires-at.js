import { eq } from 'drizzle-orm';
import { retentionPolicies } from '../../database/schema/index.js';
import { DEFAULT_RETENTION_DAYS, expiresAtForNewMessage } from '../../services/retention-policy.js';

export async function expiresAtForInsert(db, createdAt = new Date()) {
  const [row] = await db
    .select({ days: retentionPolicies.retentionDays })
    .from(retentionPolicies)
    .where(eq(retentionPolicies.id, 'default'));
  return expiresAtForNewMessage(createdAt, row?.days ?? DEFAULT_RETENTION_DAYS);
}
