import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/notifications/pending_call.dart';
import 'package:company_chat/core/notifications/pending_route.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:uuid/uuid.dart';

class NotificationActions {
  static Future<void> fromResponse(NotificationResponse response) async {
    final payload = decodePayload(response.payload);
    final callId = payload['callId'];
    if (callId != null && callId.isNotEmpty) {
      final action = response.actionId ?? payload['action'] ?? 'open';
      pendingCallRoute.open(
        callId,
        callAction: action == 'accept_call' || action == 'accept'
            ? 'accept'
            : action == 'reject_call' || action == 'reject'
                ? 'reject'
                : 'open',
      );
      return;
    }
    final conversationId = payload['conversationId'];
    if (conversationId == null || conversationId.isEmpty) return;
    final action = response.actionId ?? payload['action'] ?? 'open';
    if (action == 'reply') {
      final text = response.input?.trim() ?? '';
      if (text.isEmpty) return;
      await _authed((api) {
        return api.post('/api/v1/conversations/$conversationId/messages', data: {
          'clientMessageId': const Uuid().v4(),
          'content': text,
        });
      });
      return;
    }
    if (action == 'mark_read') {
      final seq = int.tryParse(payload['sequenceNumber'] ?? '');
      if (seq == null) return;
      await _authed((api) {
        return api.post('/api/v1/conversations/$conversationId/read', data: {'sequenceNumber': seq});
      });
      return;
    }
    pendingNotificationRoute.open(conversationId);
  }

  static Map<String, String> decodePayload(String? raw) {
    if (raw == null || raw.isEmpty) return {};
    try {
      final parts = raw.split('&');
      final map = <String, String>{};
      for (final part in parts) {
        final index = part.indexOf('=');
        if (index <= 0) continue;
        map[Uri.decodeComponent(part.substring(0, index))] = Uri.decodeComponent(part.substring(index + 1));
      }
      return map;
    } catch (_) {
      return {};
    }
  }

  static String encodePayload(Map<String, String> data) {
    return data.entries
        .where((entry) => entry.value.isNotEmpty)
        .map((entry) => '${Uri.encodeComponent(entry.key)}=${Uri.encodeComponent(entry.value)}')
        .join('&');
  }

  static Future<void> _authed(Future<void> Function(ApiClient api) run) async {
    final store = SessionStore();
    final api = ApiClient(store);
    try {
      await api.refresh();
      await run(api);
    } catch (_) {}
  }
}
