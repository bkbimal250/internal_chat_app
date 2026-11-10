import {
  pgEnum,
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';
import { users } from './users.js';
import { messages } from './messages.js';

export const attachmentStatus = pgEnum('attachment_status', [
  'pending',
  'quarantined',
  'available',
  'rejected',
  'deleted',
]);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    storageKey: varchar('storage_key', { length: 128 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 127 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }),
    kind: varchar('kind', { length: 16 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: attachmentStatus('status').notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    multipartUploadId: varchar('multipart_upload_id', { length: 256 }),
    uploadExpiresAt: timestamp('upload_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('attachments_storage_key_unique').on(t.storageKey),
    index('attachments_conversation_idx').on(t.conversationId, t.createdAt),
    index('attachments_uploader_idx').on(t.uploaderId, t.createdAt),
    index('attachments_status_idx').on(t.status, t.uploadExpiresAt),
    index('attachments_message_idx').on(t.messageId, t.sortOrder),
  ],
);
