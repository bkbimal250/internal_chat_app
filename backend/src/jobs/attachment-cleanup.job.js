import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { attachments } from '../database/schema/index.js';

export async function cleanupAttachments(app) {
  const expired = await app.database.db
    .select()
    .from(attachments)
    .where(
      and(
        or(eq(attachments.status, 'pending'), eq(attachments.status, 'quarantined')),
        lt(attachments.uploadExpiresAt, new Date()),
      ),
    );
  const rejected = await app.database.db
    .select()
    .from(attachments)
    .where(and(eq(attachments.status, 'deleted'), isNull(attachments.messageId)));
  for (const row of [...expired, ...rejected]) {
    await app.storage.remove(row.storageKey).catch(() => {});
    if (row.status !== 'deleted') {
      await app.database.db
        .update(attachments)
        .set({ status: 'deleted', deletedAt: new Date(), rejectionReason: 'abandoned' })
        .where(eq(attachments.id, row.id));
    }
  }
  return expired.length;
}
