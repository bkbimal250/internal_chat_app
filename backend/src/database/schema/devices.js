import { pgTable, pgEnum, uuid, varchar, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const devicePlatform = pgEnum('device_platform', ['web', 'android', 'ios']);
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    deviceName: varchar('device_name', { length: 120 }).notNull(),
    platform: devicePlatform('platform').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    pushToken: varchar('push_token', { length: 4096 }),
    pushTokenUpdatedAt: timestamp('push_token_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('devices_user_idx').on(t.userId),
    unique('devices_id_user_unique').on(t.id, t.userId),
  ],
);
