import 'dart:async';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/notifications/in_app_banner.dart';
import 'package:company_chat/core/notifications/notify_incoming.dart';
import 'package:company_chat/core/notifications/notification_copy.dart';
import 'package:company_chat/core/notifications/notification_prefs.dart';
import 'package:company_chat/core/notifications/pending_route.dart';
import 'package:company_chat/core/notifications/push_notifications.dart';
import 'package:company_chat/core/utils/preview_text.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/conversations/presentation/conversations_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class NotificationHost extends ConsumerStatefulWidget {
  const NotificationHost({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<NotificationHost> createState() => _NotificationHostState();
}

class _NotificationHostState extends ConsumerState<NotificationHost> with WidgetsBindingObserver {
  StreamSubscription<Map<String, dynamic>>? _sub;
  InAppNotice? _notice;
  Timer? _hide;
  final Set<String> _seen = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    PushNotifications.onForegroundData = _fromPush;
    _sub = ref.read(chatSocketProvider).events.listen(_fromSocket);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    ref.read(appLifecycleProvider.notifier).state = state;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (PushNotifications.onForegroundData == _fromPush) {
      PushNotifications.onForegroundData = null;
    }
    _sub?.cancel();
    _hide?.cancel();
    super.dispose();
  }

  void _fromPush(Map<String, String> data) {
    final type = data['type'] ?? '';
    if (type == 'incoming_call') {
      final callId = data['callId'] ?? '';
      if (callId.isNotEmpty) {
        PushNotifications.onIncomingCall?.call(callId);
      }
      return;
    }
    if (type.startsWith('retention')) {
      _present(
        InAppNotice(
          conversationId: data['conversationId'] ?? '',
          title: data['title'] ?? 'Company Chat',
          body: data['body'] ?? 'Retention reminder',
        ),
        data['messageId'] ?? data['notificationId'],
      );
      return;
    }
    if (type != 'message') return;
    _present(
      InAppNotice(
        conversationId: data['conversationId'] ?? '',
        title: data['groupTitle']?.isNotEmpty == true ? data['groupTitle']! : (data['senderName'] ?? data['title'] ?? 'Company Chat'),
        body: data['body'] ?? 'New message',
        senderId: data['senderId'],
        hasPhoto: data['senderHasPhoto'] == 'true',
        isGroup: data['conversationType'] == 'group',
      ),
      data['messageId'],
    );
  }

  void _fromSocket(Map<String, dynamic> event) {
    if (event['event'] != 'message.created') return;
    final data = (event['data'] as Map?)?.cast<String, dynamic>() ?? {};
    final me = ref.read(authControllerProvider).user?.id;
    if (data['senderId'] == null || data['senderId'] == me) return;
    final conversationId = data['conversationId'] as String?;
    if (conversationId == null) return;
    final prefs = ref.read(notificationPrefsProvider);
    if (!prefs.messagesEnabled || prefs.isMuted(conversationId)) return;
    final conversations = ref.read(conversationsControllerProvider);
    final conversation = conversations.items.where((row) => row['id'] == conversationId).firstOrNull;
    final isGroup = conversation?['type'] == 'group' || data['conversationType'] == 'group';
    final members = ((conversation?['members'] as List?) ?? []).whereType<Map>();
    final sender = members
        .map((member) => Map<String, dynamic>.from(member))
        .where((member) => member['id'] == data['senderId'])
        .firstOrNull;
    final senderName = senderLabel(sender);
    final groupTitle = isGroup
        ? ((conversation?['title'] as String?)?.trim().isNotEmpty == true
            ? conversation!['title'] as String
            : 'Group')
        : null;
    final copy = messageNotificationCopy(
      isGroup: isGroup,
      groupTitle: groupTitle,
      senderName: senderName,
      preview: previewText(data),
      showPreview: prefs.showPreview,
    );
    _present(
      InAppNotice(
        conversationId: conversationId,
        title: copy.title,
        body: copy.body,
        senderId: data['senderId'] as String?,
        hasPhoto: sender?['hasProfilePhoto'] == true,
        isGroup: isGroup,
      ),
      data['id'] as String?,
    );
  }

  void _present(InAppNotice notice, String? id) {
    if (!shouldPresentIncomingNotice(
      senderId: notice.senderId,
      currentUserId: ref.read(authControllerProvider).user?.id,
      conversationId: notice.conversationId,
      viewedConversationId: ref.read(viewedConversationProvider),
      lifecycle: ref.read(appLifecycleProvider),
      messageId: id,
      seenIds: _seen,
    )) {
      return;
    }
    final prefs = ref.read(notificationPrefsProvider);
    if (!prefs.messagesEnabled || prefs.isMuted(notice.conversationId)) return;
    setState(() => _notice = notice);
    _hide?.cancel();
    _hide = Timer(const Duration(seconds: 5), () {
      if (mounted) setState(() => _notice = null);
    });
  }

  void _open() {
    final notice = _notice;
    if (notice == null) return;
    setState(() => _notice = null);
    pendingNotificationRoute.open(notice.conversationId);
    context.go('/chats/${notice.conversationId}');
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (_notice != null)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: InAppBanner(
              notice: _notice!,
              onOpen: _open,
              onDismiss: () => setState(() => _notice = null),
            ),
          ),
      ],
    );
  }
}
