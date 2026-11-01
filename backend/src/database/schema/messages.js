import { sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';
import { users } from './users.js';
export const messageType = pgEnum('message_type', ['text', 'system', 'image', 'video', 'audio', 'file']);
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'restrict' }),
    clientMessageId: uuid('client_message_id'),
    sequenceNumber: bigint('sequence_number', { mode: 'number' }).notNull(),
    changeSeq: bigint('change_seq', { mode: 'number' }).notNull().default(0),
    messageType: messageType('message_type').notNull().default('text'),
    content: text('content').notNull(),
    replyToMessageId: uuid('reply_to_message_id').references(() => messages.id, {
      onDelete: 'restrict',
    }),
    forwardedFromMessageId: uuid('forwarded_from_message_id').references(() => messages.id, {
      onDelete: 'restrict',
    }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_conversation_client_unique')
      .on(t.conversationId, t.clientMessageId)
      .where(sql`${t.clientMessageId} is not null`),
    uniqueIndex('messages_sequence_unique').on(t.conversationId, t.sequenceNumber),
    uniqueIndex('messages_change_unique').on(t.conversationId, t.changeSeq),
    index('messages_history_idx').on(t.conversationId, t.sequenceNumber),
    index('messages_change_idx').on(t.conversationId, t.changeSeq),
    index('messages_expires_idx').on(t.expiresAt),
  ],
);
