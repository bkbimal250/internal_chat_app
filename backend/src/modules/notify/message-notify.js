import { and, eq, isNull } from 'drizzle-orm';
import {
  conversationMembers,
  conversations,
  users,
} from '../../database/schema/index.js';
import { messageNotificationCopy, messagePreview, senderLabel } from '../../services/notify-copy.js';
import { getNotificationPrefs, isConversationMuted } from './prefs.js';

export async function notifyNewMessage(app, message) {
  if (!app.push || !message || message.duplicate) return { sent: 0 };
  if (message.messageType === 'system' || !message.senderId) return { sent: 0 };
  if (message.deletedAt || message.expiredAt) return { sent: 0 };

  const db = app.database.db;
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, message.conversationId));
  if (!conversation) return { sent: 0 };

  const members = await db
    .select({
      userId: conversationMembers.userId,
      displayName: users.displayName,
      fullName: users.fullName,
      hasProfilePhoto: users.profilePhotoKey,
    })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(
      and(eq(conversationMembers.conversationId, conversation.id), isNull(conversationMembers.leftAt)),
    );

  const sender = members.find((member) => member.userId === message.senderId);
  const senderName = senderLabel(sender);
  const isGroup = conversation.type === 'group';
  const groupTitle = isGroup ? conversation.title || 'Group' : '';
  const preview = messagePreview(message);
  const senderHasPhoto = Boolean(sender?.hasProfilePhoto);

  let sent = 0;
  for (const member of members) {
    if (member.userId === message.senderId) continue;
    const prefs = await getNotificationPrefs(db, member.userId);
    if (!prefs.messagesEnabled) continue;
    if (await isConversationMuted(db, member.userId, conversation.id)) continue;

    const copy = messageNotificationCopy({
      isGroup,
      groupTitle,
      senderName,
      preview,
      showPreview: prefs.showPreview,
    });

    const data = {
      type: 'message',
      conversationId: conversation.id,
      messageId: message.id,
      senderId: message.senderId,
      conversationType: conversation.type,
      sequenceNumber: String(message.sequenceNumber ?? ''),
      senderHasPhoto: senderHasPhoto ? 'true' : 'false',
      sound: prefs.sound ? 'true' : 'false',
      visibility: prefs.showSenderOnLockScreen && prefs.showPreview ? 'public' : 'private',
    };
    if (prefs.showPreview) {
      data.senderName = senderName;
      if (isGroup) data.groupTitle = groupTitle;
    }

    const result = await app.push
      .sendToUser(member.userId, {
        title: copy.title,
        body: copy.body,
        data,
        collapseKey: prefs.groupNotifications ? conversation.id : undefined,
        android: {
          channelId: 'company_chat_messages',
          tag: conversation.id,
          dataOnly: true,
          sound: prefs.sound,
          vibrate: prefs.vibration,
          visibility: prefs.showSenderOnLockScreen && prefs.showPreview ? 'public' : 'private',
        },
        apns: {
          threadId: conversation.id,
          category: 'MESSAGE',
          sound: prefs.sound,
        },
      })
      .catch((error) => {
        app.log?.warn({ err: error, code: 'MESSAGE_PUSH_FAILED' }, 'Unable to fan out message push');
        return { sent: 0 };
      });
    sent += result?.sent || 0;
  }
  return { sent };
}
