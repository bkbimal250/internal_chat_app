import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { messages } from './messages.js';
import { users } from './users.js';

export const messageHides = pgTable(
  'message_hides',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index('message_hides_user_idx').on(t.userId),
  ],
);
