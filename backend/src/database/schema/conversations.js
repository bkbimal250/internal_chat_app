import { sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
export const conversationType = pgEnum('conversation_type', ['direct', 'group']);
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: conversationType('type').notNull(),
    title: varchar('title', { length: 120 }),
    description: text('description'),
    avatarReference: varchar('avatar_reference', { length: 512 }),
    editInfoPolicy: varchar('edit_info_policy', { length: 16 }).notNull().default('admins'),
    sendMessagesPolicy: varchar('send_messages_policy', { length: 16 }).notNull().default('all'),
    addMembersPolicy: varchar('add_members_policy', { length: 16 }).notNull().default('admins'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    lastMessageSeq: bigint('last_message_seq', { mode: 'number' }).notNull().default(0),
    lastChangeSeq: bigint('last_change_seq', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversations_updated_idx').on(t.updatedAt)],
);
export const directConversationPairs = pgTable(
  'direct_conversation_pairs',
  {
    conversationId: uuid('conversation_id')
      .primaryKey()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    canonicalUserId1: uuid('canonical_user_id_1')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    canonicalUserId2: uuid('canonical_user_id_2')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    uniqueIndex('direct_pairs_unique').on(t.canonicalUserId1, t.canonicalUserId2),
    check('direct_pair_distinct', sql`${t.canonicalUserId1} < ${t.canonicalUserId2}`),
  ],
);
