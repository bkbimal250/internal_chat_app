import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  bigint,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';
import { users } from './users.js';

export const retentionPolicies = pgTable('retention_policies', {
  id: varchar('id', { length: 32 }).primaryKey(),
  retentionDays: integer('retention_days').notNull().default(90),
  remindersEnabled: boolean('reminders_enabled').notNull().default(true),
  cleanupEnabled: boolean('cleanup_enabled').notNull().default(false),
  cleanupApprovedAt: timestamp('cleanup_approved_at', { withTimezone: true }),
  cleanupApprovedBy: uuid('cleanup_approved_by').references(() => users.id, { onDelete: 'set null' }),
  existingGraceDays: integer('existing_grace_days').notNull().default(90),
  legalHold: boolean('legal_hold').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const retentionHolds = pgTable(
  'retention_holds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 255 }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [index('retention_holds_open_idx').on(t.conversationId, t.releasedAt)],
);

export const retentionReminders = pgTable(
  'retention_reminders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    windowKey: varchar('window_key', { length: 8 }).notNull(),
    expiresOn: varchar('expires_on', { length: 10 }).notNull(),
    messageCount: integer('message_count').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('retention_reminders_unique').on(t.conversationId, t.windowKey, t.expiresOn)],
);

export const retentionJobs = pgTable(
  'retention_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: varchar('kind', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    lastError: varchar('last_error', { length: 500 }),
    stats: jsonb('stats').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('retention_jobs_status_idx').on(t.status, t.createdAt)],
);

export const retentionExports = pgTable(
  'retention_exports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    storageKey: varchar('storage_key', { length: 160 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    error: varchar('error', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
  },
  (t) => [index('retention_exports_user_idx').on(t.userId, t.createdAt)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 64 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    body: varchar('body', { length: 500 }).notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);
