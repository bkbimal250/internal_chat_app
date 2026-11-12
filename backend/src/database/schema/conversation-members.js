import { pgEnum, pgTable, uuid, bigint, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';
import { users } from './users.js';
export const memberRole = pgEnum('conversation_member_role', ['owner', 'admin', 'member']);
export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: memberRole('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    hiddenUntilSeq: bigint('hidden_until_seq', { mode: 'number' }),
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index('conversation_members_user_idx').on(t.userId, t.leftAt),
  ],
);
