import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { devices } from './devices.js';

export const clientTransport = pgEnum('client_transport', ['web', 'native']);
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    tokenFamilyId: uuid('token_family_id').notNull().defaultRandom(),
    transport: clientTransport('transport').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text('revocation_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.deviceId, t.userId],
      foreignColumns: [devices.id, devices.userId],
      name: 'sessions_device_owner_fk',
    }).onDelete('restrict'),
    uniqueIndex('sessions_refresh_hash_unique').on(t.refreshTokenHash),
    uniqueIndex('sessions_family_unique').on(t.tokenFamilyId),
    index('sessions_user_active_idx').on(t.userId, t.revokedAt, t.expiresAt),
    index('sessions_expiry_idx').on(t.expiresAt),
  ],
);

// Consumed hashes must remain until the session's absolute expiry to detect replay.
export const consumedRefreshTokens = pgTable(
  'consumed_refresh_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('consumed_refresh_expiry_idx').on(t.expiresAt)],
);
