import { and, eq, isNull } from 'drizzle-orm';
import { conversationMembers, notificationPreferences } from '../../database/schema/index.js';

export const DEFAULT_NOTIFICATION_PREFS = {
  messagesEnabled: true,
  sound: true,
  vibration: true,
  showPreview: true,
  showSenderOnLockScreen: true,
  groupNotifications: true,
  retentionReminders: true,
};

export function presentPrefs(row) {
  if (!row) return { ...DEFAULT_NOTIFICATION_PREFS };
  return {
    messagesEnabled: row.messagesEnabled,
    sound: row.sound,
    vibration: row.vibration,
    showPreview: row.showPreview,
    showSenderOnLockScreen: row.showSenderOnLockScreen,
    groupNotifications: row.groupNotifications,
    retentionReminders: row.retentionReminders,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

export async function getNotificationPrefs(db, userId) {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  return presentPrefs(row);
}

export function isMutedUntil(mutedUntil, now = new Date()) {
  return Boolean(mutedUntil && new Date(mutedUntil).getTime() > now.getTime());
}

export async function isConversationMuted(db, userId, conversationId) {
  const [row] = await db
    .select({ mutedUntil: conversationMembers.mutedUntil })
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.userId, userId),
        eq(conversationMembers.conversationId, conversationId),
        isNull(conversationMembers.leftAt),
      ),
    );
  return isMutedUntil(row?.mutedUntil);
}
