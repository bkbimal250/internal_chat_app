import { pgTable, uuid, varchar, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { messages } from './messages.js';
import { users } from './users.js';

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    emoji: varchar('emoji', { length: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index('message_reactions_message_idx').on(t.messageId),
  ],
);
