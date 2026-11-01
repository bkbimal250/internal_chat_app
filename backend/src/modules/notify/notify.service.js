import { and, eq, isNull } from 'drizzle-orm';
import { conversationMembers, notificationPreferences } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { conversationService } from '../conversations/conversations.service.js';
import { getNotificationPrefs, isMutedUntil } from './prefs.js';

const INDEFINITE_MUTE = new Date('9999-12-31T00:00:00.000Z');

export function notifyService(app) {
  const db = app.database.db;
  const conversations = conversationService(app);

  return {
    async getPreferences(userId) {
      const prefs = await getNotificationPrefs(db, userId);
      const mutes = await db
        .select({
          conversationId: conversationMembers.conversationId,
          mutedUntil: conversationMembers.mutedUntil,
        })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.userId, userId), isNull(conversationMembers.leftAt)));
      return {
        ...prefs,
        mutedConversationIds: mutes
          .filter((row) => isMutedUntil(row.mutedUntil))
          .map((row) => row.conversationId),
      };
    },

    async updatePreferences(userId, patch) {
      const current = await getNotificationPrefs(db, userId);
      const next = {
        messagesEnabled: patch.messagesEnabled ?? current.messagesEnabled,
        sound: patch.sound ?? current.sound,
        vibration: patch.vibration ?? current.vibration,
        showPreview: patch.showPreview ?? current.showPreview,
        showSenderOnLockScreen: patch.showSenderOnLockScreen ?? current.showSenderOnLockScreen,
        groupNotifications: patch.groupNotifications ?? current.groupNotifications,
        retentionReminders: patch.retentionReminders ?? current.retentionReminders,
        updatedAt: new Date(),
      };
      await db
        .insert(notificationPreferences)
        .values({ userId, ...next })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: next,
        });
      return this.getPreferences(userId);
    },

    async mute(conversationId, userId, { muted, until } = {}) {
      await conversations.assertMember(conversationId, userId);
      let mutedUntil = null;
      if (muted) {
        mutedUntil = until ? new Date(until) : INDEFINITE_MUTE;
        if (Number.isNaN(mutedUntil.getTime())) {
          throw new AppError('Invalid mute expiry', 400, 'INVALID_MUTE');
        }
      }
      const [row] = await db
        .update(conversationMembers)
        .set({ mutedUntil })
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, userId),
            isNull(conversationMembers.leftAt),
          ),
        )
        .returning({
          conversationId: conversationMembers.conversationId,
          mutedUntil: conversationMembers.mutedUntil,
        });
      return {
        conversationId,
        muted: isMutedUntil(row?.mutedUntil),
        mutedUntil: row?.mutedUntil instanceof Date ? row.mutedUntil.toISOString() : row?.mutedUntil ?? null,
      };
    },
  };
}
