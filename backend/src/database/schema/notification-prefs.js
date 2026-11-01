import { pgTable, uuid, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  messagesEnabled: boolean('messages_enabled').notNull().default(true),
  sound: boolean('sound').notNull().default(true),
  vibration: boolean('vibration').notNull().default(true),
  showPreview: boolean('show_preview').notNull().default(true),
  showSenderOnLockScreen: boolean('show_sender_on_lock_screen').notNull().default(true),
  groupNotifications: boolean('group_notifications').notNull().default(true),
  retentionReminders: boolean('retention_reminders').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
