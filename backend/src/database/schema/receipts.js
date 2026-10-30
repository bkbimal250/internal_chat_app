import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { messages } from './messages.js';
import { users } from './users.js';
export const messageReceipts = pgTable(
  'message_receipts',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index('receipts_user_idx').on(t.userId),
  ],
);
