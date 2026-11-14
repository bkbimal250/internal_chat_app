import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/notifications/unread_inbox.dart';
import 'package:company_chat/core/utils/preview_text.dart';
import 'package:company_chat/core/notifications/notification_copy.dart';

class NotificationSync {
  const NotificationSync(this.api);

  final ApiClient api;

  Future<UnreadInbox> hydrateConversation(UnreadInbox inbox, String conversationId) async {
    if (conversationId.isEmpty) return inbox;
    final details = await api.get<Map<String, dynamic>>('/api/v1/conversations/$conversationId');
    final me = inbox.userId ?? await _currentUserId();
    final members = ((details['members'] as List?) ?? []).whereType<Map>();
    final mine = members.cast<Map>().where((row) => row['id'] == me).firstOrNull;
    final lastRead = (mine?['lastReadSeq'] as num?)?.toInt() ?? 0;
    final lastMessageSeq = (details['lastMessageSeq'] as num?)?.toInt() ?? 0;
    final unreadCount = lastMessageSeq > lastRead ? lastMessageSeq - lastRead : null;
    final page = await api.get<Map<String, dynamic>>(
      '/api/v1/conversations/$conversationId/messages',
      query: {'afterSeq': lastRead, 'limit': androidMessagingStyleLimit},
    );
    final rows = ((page['data'] as List?) ?? []).whereType<Map>().map(Map<String, dynamic>.from);
    final isGroup = details['type'] == 'group';
    final title = isGroup
        ? ((details['title'] as String?)?.trim().isNotEmpty == true ? details['title'] as String : 'Group')
        : _directTitle(details, me);
    final incoming = <InboxMessage>[];
    for (final row in rows) {
      if (row['senderId'] == me || row['messageType'] == 'system' || row['id'] == null) continue;
      incoming.add(_toInbox(row, members));
    }
    return inbox.mergeServerMessages(
      conversationId: conversationId,
      title: title,
      isGroup: isGroup,
      incoming: incoming,
      unreadCount: unreadCount ?? incoming.length,
    ).bindUser(me);
  }

  Future<String?> _currentUserId() async {
    try {
      final me = await api.get<Map<String, dynamic>>('/api/v1/auth/me');
      return me['id'] as String?;
    } on ApiError {
      rethrow;
    }
  }

  String _directTitle(Map<String, dynamic> conversation, String? me) {
    final members = ((conversation['members'] as List?) ?? []).whereType<Map>();
    final peer = members.cast<Map>().where((row) => row['id'] != me).firstOrNull;
    return senderLabel(peer == null ? null : Map<String, dynamic>.from(peer));
  }

  InboxMessage _toInbox(Map<String, dynamic> message, Iterable<Map> members) {
    final sender = members
        .map((row) => Map<String, dynamic>.from(row))
        .where((row) => row['id'] == message['senderId'])
        .firstOrNull;
    return InboxMessage(
      id: message['id'] as String,
      senderId: message['senderId'] as String? ?? '',
      senderName: senderLabel(sender),
      text: previewText(message),
      at: DateTime.tryParse(message['createdAt']?.toString() ?? '') ?? DateTime.now().toUtc(),
      sequenceNumber: (message['sequenceNumber'] as num?)?.toInt() ?? 0,
    );
  }
}
