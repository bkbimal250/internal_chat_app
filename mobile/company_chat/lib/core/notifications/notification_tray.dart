import 'dart:io';
import 'dart:ui';

import 'package:company_chat/core/notifications/notification_payload.dart';
import 'package:company_chat/core/notifications/unread_inbox.dart';
import 'package:company_chat/core/notifications/unread_inbox_store.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

const messagesChannelId = 'company_chat_messages';
const retentionChannelId = 'company_chat_retention';
const callsChannelId = 'michat_calls';

final FlutterLocalNotificationsPlugin notificationPlugin = FlutterLocalNotificationsPlugin();

class NotificationTray {
  static bool ready = false;

  static Future<void> ensureInitialized({
    void Function(NotificationResponse response)? onTap,
    DidReceiveBackgroundNotificationResponseCallback? onBackgroundTap,
  }) async {
    if (ready) return;
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    final ios = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
      notificationCategories: [
        DarwinNotificationCategory(
          'MESSAGE',
          actions: [
            DarwinNotificationAction.text(
              'reply',
              'Reply',
              buttonTitle: 'Send',
              placeholder: 'Reply',
            ),
            DarwinNotificationAction.plain('mark_read', 'Mark as read'),
          ],
        ),
      ],
    );
    await notificationPlugin.initialize(
      InitializationSettings(android: android, iOS: ios),
      onDidReceiveNotificationResponse: onTap,
      onDidReceiveBackgroundNotificationResponse: onBackgroundTap,
    );
    final androidPlugin = notificationPlugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    await androidPlugin?.createNotificationChannel(
      const AndroidNotificationChannel(
        messagesChannelId,
        'Messages',
        description: 'Incoming MiChat messages',
        importance: Importance.high,
        playSound: true,
        enableVibration: true,
      ),
    );
    await androidPlugin?.createNotificationChannel(
      const AndroidNotificationChannel(
        retentionChannelId,
        'Retention reminders',
        description: 'Chat retention reminders',
        importance: Importance.defaultImportance,
      ),
    );
    await androidPlugin?.createNotificationChannel(
      const AndroidNotificationChannel(
        callsChannelId,
        'Voice calls',
        description: 'Incoming MiChat voice calls',
        importance: Importance.max,
        playSound: true,
        enableVibration: true,
      ),
    );
    ready = true;
  }

  static Future<UnreadInbox> showConversation(UnreadInbox inbox, String conversationId) async {
    await ensureInitialized();
    final thread = inbox.thread(conversationId);
    if (thread == null || thread.messages.isEmpty || !inbox.messagesEnabled) {
      await cancelConversation(conversationId);
      return inbox.clearConversation(conversationId);
    }
    if (kIsWeb) return inbox;
    final visible = thread.visible;
    final title = thread.title.isEmpty ? 'MiChat' : thread.title;
    final body = collapsedNotificationBody(thread, showPreview: inbox.showPreview);
    final visibility = inbox.showSenderOnLockScreen && inbox.showPreview
        ? NotificationVisibility.public
        : NotificationVisibility.private;
    final payload = NotificationPayload.encode({
      'conversationId': conversationId,
      'messageId': thread.latest?.id ?? '',
      'sequenceNumber': '${thread.latestSequence}',
      'action': 'open',
    });
    if (!kIsWeb && Platform.isAndroid) {
      final me = Person(name: 'You', key: inbox.userId ?? 'me');
      final messages = [
        for (final row in visible)
          Message(
            displayMessageText(row, showPreview: inbox.showPreview),
            row.at.toLocal(),
            Person(
              key: row.senderId,
              name: displaySenderName(
                row,
                showPreview: inbox.showPreview,
                showSender: inbox.showSenderOnLockScreen,
              ),
            ),
          ),
      ];
      await notificationPlugin.show(
        notificationIdForConversation(conversationId),
        title,
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            messagesChannelId,
            'Messages',
            channelDescription: 'Incoming MiChat messages',
            importance: Importance.high,
            priority: Priority.high,
            category: AndroidNotificationCategory.message,
            visibility: visibility,
            groupKey: conversationId,
            tag: conversationId,
            number: thread.badgeCount,
            subText: thread.badgeCount > 1 ? '${thread.badgeCount} new messages' : null,
            color: const Color(0xFFC6A04B),
            colorized: false,
            styleInformation: MessagingStyleInformation(
              me,
              conversationTitle: thread.isGroup ? title : null,
              groupConversation: thread.isGroup,
              messages: messages,
            ),
            actions: const <AndroidNotificationAction>[
              AndroidNotificationAction(
                'reply',
                'Reply',
                inputs: [AndroidNotificationActionInput(label: 'Reply')],
                cancelNotification: false,
              ),
              AndroidNotificationAction('mark_read', 'Mark as read'),
              AndroidNotificationAction('open', 'Open'),
            ],
          ),
        ),
        payload: payload,
      );
      return inbox;
    }
    final posted = <int>[...thread.postedNotificationIds];
    for (final row in visible) {
      final id = notificationIdForMessage(row.id);
      if (posted.contains(id)) continue;
      await notificationPlugin.show(
        id,
        title,
        inbox.showPreview
            ? (thread.isGroup ? '${row.senderName}: ${row.text}' : row.text)
            : 'New message',
        NotificationDetails(
          iOS: DarwinNotificationDetails(
            threadIdentifier: conversationId,
            categoryIdentifier: 'MESSAGE',
            presentAlert: true,
            presentSound: true,
            subtitle: thread.badgeCount > 1 ? '${thread.badgeCount} new messages' : null,
          ),
        ),
        payload: payload,
      );
      posted.add(id);
    }
    return inbox.markPosted(conversationId, posted);
  }

  static Future<void> cancelConversation(String conversationId, {Iterable<int> extraIds = const []}) async {
    await ensureInitialized();
    await notificationPlugin.cancel(notificationIdForConversation(conversationId), tag: conversationId);
    await notificationPlugin.cancel(notificationIdForConversation(conversationId));
    for (final id in extraIds) {
      await notificationPlugin.cancel(id);
    }
  }

  static Future<void> cancelAll() async {
    await ensureInitialized();
    await notificationPlugin.cancelAll();
  }

  static Future<void> dismissConversation(String conversationId) async {
    final inbox = await unreadInboxStore.load();
    final extra = inbox.thread(conversationId)?.postedNotificationIds ?? const <int>[];
    await cancelConversation(conversationId, extraIds: extra);
    await unreadInboxStore.save(inbox.clearConversation(conversationId));
  }

  static Future<void> clearSession() async {
    await cancelAll();
    await unreadInboxStore.save(const UnreadInbox());
  }
}

