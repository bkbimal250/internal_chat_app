import 'dart:async';
import 'dart:io';

import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/notifications/notification_actions.dart';
import 'package:company_chat/core/notifications/pending_call.dart';
import 'package:company_chat/core/notifications/pending_route.dart';
import 'package:company_chat/firebase_options.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

const messagesChannelId = 'company_chat_messages';
const retentionChannelId = 'company_chat_retention';
const callsChannelId = 'company_chat_calls';

typedef ForegroundNotice = void Function(Map<String, String> data);
typedef IncomingCallNotice = void Function(String callId);

final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
final Set<String> _seenMessageIds = <String>{};

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  }
  await PushNotifications.ensureLocalPlugin();
  await PushNotifications.displayRemote(message, background: true);
}

@pragma('vm:entry-point')
void notificationTapBackground(NotificationResponse response) {
  unawaited(NotificationActions.fromResponse(response));
}

class PushNotifications {
  static ForegroundNotice? onForegroundData;
  static IncomingCallNotice? onIncomingCall;
  static bool _localReady = false;

  static Future<void> initialize() async {
    if (kIsWeb || !(Platform.isAndroid || Platform.isIOS)) return;
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    }
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    await ensureLocalPlugin();
    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(alert: true, badge: true, sound: true);
    await messaging.setForegroundNotificationPresentationOptions(
      alert: false,
      badge: true,
      sound: false,
    );
    if (Platform.isIOS) {
      await messaging.setAutoInitEnabled(true);
    }
    if (Platform.isAndroid) {
      await _plugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
    }
    FirebaseMessaging.onMessage.listen((message) {
      onForegroundData?.call(_asStringMap(message.data));
    });
    FirebaseMessaging.onMessageOpenedApp.listen(_openRemote);
    final initial = await messaging.getInitialMessage();
    if (initial != null) _openRemote(initial);
    final launch = await _plugin.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp == true && launch?.notificationResponse != null) {
      await NotificationActions.fromResponse(launch!.notificationResponse!);
    }
  }

  static Future<void> ensureLocalPlugin() async {
    if (_localReady) return;
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    final ios = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
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
        DarwinNotificationCategory(
          'INCOMING_CALL',
          actions: [
            DarwinNotificationAction.plain('accept_call', 'Accept', options: {DarwinNotificationActionOption.foreground}),
            DarwinNotificationAction.plain('reject_call', 'Decline', options: {DarwinNotificationActionOption.destructive}),
          ],
        ),
      ],
    );
    await _plugin.initialize(
      InitializationSettings(android: android, iOS: ios),
      onDidReceiveNotificationResponse: NotificationActions.fromResponse,
      onDidReceiveBackgroundNotificationResponse: notificationTapBackground,
    );
    final androidPlugin = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    await androidPlugin?.createNotificationChannel(
      const AndroidNotificationChannel(
        messagesChannelId,
        'Messages',
        description: 'Incoming Company Chat messages',
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
    _localReady = true;
  }

  static Future<void> register(ApiClient api) async {
    if (kIsWeb || !(Platform.isAndroid || Platform.isIOS)) return;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
      }
      final messaging = FirebaseMessaging.instance;
      final token = await messaging.getToken();
      if (token == null || token.isEmpty) return;
      await api.put('/api/v1/devices/push-token', data: {'token': token});
      messaging.onTokenRefresh.listen((next) {
        if (next.isEmpty) return;
        api.put('/api/v1/devices/push-token', data: {'token': next});
      });
    } catch (_) {}
  }

  static Future<void> displayRemote(RemoteMessage message, {bool background = false}) async {
    final data = _asStringMap(message.data);
    if (data['title'] == null || data['title']!.isEmpty) {
      data['title'] = message.notification?.title ?? 'Company Chat';
    }
    if (data['body'] == null || data['body']!.isEmpty) {
      data['body'] = message.notification?.body ?? '';
    }
    final type = data['type'] ?? '';
    if (type == 'incoming_call') {
      final callId = data['callId'] ?? '';
      if (callId.isEmpty) return;
      if (!background) {
        onIncomingCall?.call(callId);
        return;
      }
      await showIncomingCall(data);
      return;
    }
    final messageId = data['messageId'];
    if (messageId != null && messageId.isNotEmpty && !_seenMessageIds.add(messageId)) return;
    if (!background) return;
    if (Platform.isIOS && message.notification != null) return;
    await showLocal(data, type.startsWith('retention') ? retentionChannelId : messagesChannelId);
  }

  static Future<void> showIncomingCall(Map<String, String> data) async {
    await ensureLocalPlugin();
    final callId = data['callId'] ?? '';
    final title = data['callerName']?.isNotEmpty == true ? data['callerName']! : (data['title'] ?? 'MiChat');
    await _plugin.show(
      callId.hashCode & 0x7fffffff,
      title,
      'Incoming voice call',
      NotificationDetails(
        android: AndroidNotificationDetails(
          callsChannelId,
          'Voice calls',
          channelDescription: 'Incoming MiChat voice calls',
          importance: Importance.max,
          priority: Priority.max,
          category: AndroidNotificationCategory.call,
          fullScreenIntent: true,
          visibility: NotificationVisibility.public,
          actions: const <AndroidNotificationAction>[
            AndroidNotificationAction('accept_call', 'Accept'),
            AndroidNotificationAction('reject_call', 'Decline'),
          ],
        ),
        iOS: const DarwinNotificationDetails(
          categoryIdentifier: 'INCOMING_CALL',
          presentAlert: true,
          presentSound: true,
          interruptionLevel: InterruptionLevel.timeSensitive,
        ),
      ),
      payload: NotificationActions.encodePayload({
        'callId': callId,
        'action': 'open_call',
      }),
    );
  }

  static Future<void> showLocal(Map<String, String> data, String channelId) async {
    await ensureLocalPlugin();
    final conversationId = data['conversationId'] ?? data['notificationId'] ?? 'company-chat';
    final title = data['title'] ?? 'Company Chat';
    final body = data['body'] ?? 'New notification';
    final isGroup = data['conversationType'] == 'group';
    final senderName = data['senderName'] ?? title;
    final person = Person(name: senderName, key: data['senderId'] ?? senderName);
    final android = AndroidNotificationDetails(
      channelId,
      channelId == retentionChannelId ? 'Retention reminders' : 'Messages',
      channelDescription: 'Company Chat',
      importance: channelId == messagesChannelId ? Importance.high : Importance.defaultImportance,
      priority: channelId == messagesChannelId ? Priority.high : Priority.defaultPriority,
      category: AndroidNotificationCategory.message,
      visibility: data['visibility'] == 'private' ? NotificationVisibility.private : NotificationVisibility.public,
      groupKey: conversationId,
      styleInformation: channelId == messagesChannelId
          ? MessagingStyleInformation(
              person,
              conversationTitle: isGroup ? (data['groupTitle'] ?? title) : null,
              groupConversation: isGroup,
              messages: [Message(body, DateTime.now(), person)],
            )
          : null,
      actions: channelId == messagesChannelId
          ? <AndroidNotificationAction>[
              const AndroidNotificationAction(
                'reply',
                'Reply',
                inputs: [AndroidNotificationActionInput(label: 'Reply')],
              ),
              const AndroidNotificationAction('mark_read', 'Mark as read'),
              const AndroidNotificationAction('open', 'Open'),
            ]
          : const <AndroidNotificationAction>[],
    );
    await _plugin.show(
      conversationId.hashCode & 0x7fffffff,
      title,
      body,
      NotificationDetails(
        android: android,
        iOS: DarwinNotificationDetails(
          threadIdentifier: conversationId,
          categoryIdentifier: channelId == retentionChannelId ? 'RETENTION' : 'MESSAGE',
          presentAlert: true,
          presentSound: data['sound'] != 'false',
        ),
      ),
      payload: NotificationActions.encodePayload({
        'conversationId': conversationId,
        'messageId': data['messageId'] ?? '',
        'sequenceNumber': data['sequenceNumber'] ?? '',
        'action': 'open',
      }),
    );
  }

  static void _openRemote(RemoteMessage message) {
    final type = message.data['type']?.toString();
    if (type == 'incoming_call') {
      pendingCallRoute.open(message.data['callId']?.toString());
      return;
    }
    final conversationId = message.data['conversationId']?.toString();
    pendingNotificationRoute.open(conversationId);
  }

  static Map<String, String> _asStringMap(Map<String, dynamic> data) {
    return data.map((key, value) => MapEntry(key, value?.toString() ?? ''));
  }
}
