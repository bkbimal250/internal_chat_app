import 'dart:async';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/utils/preview_text.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class ConversationsState {
  const ConversationsState({
    this.items = const [],
    this.loading = true,
    this.query = '',
    this.filter = 'all',
    this.error,
  });

  final List<Map<String, dynamic>> items;
  final bool loading;
  final String query;
  final String filter;
  final String? error;

  List<Map<String, dynamic>> get visible {
    final needle = query.trim().toLowerCase();
    final filtered = items.where((row) {
      if (filter == 'unread' && ((row['unreadCount'] as num?) ?? 0) <= 0) return false;
      if (filter == 'groups' && row['type'] != 'group') return false;
      if (needle.isEmpty) return true;
      final title = (row['title'] ?? '').toString().toLowerCase();
      final preview = previewText(row['latestMessage'] as Map<String, dynamic>?).toLowerCase();
      final names = ((row['members'] as List?) ?? [])
          .whereType<Map>()
          .map((member) => '${member['displayName'] ?? ''} ${member['username'] ?? ''}'.toLowerCase())
          .join(' ');
      return title.contains(needle) || preview.contains(needle) || names.contains(needle);
    }).toList();
    return sortConversations(filtered);
  }

  ConversationsState copyWith({
    List<Map<String, dynamic>>? items,
    bool? loading,
    String? query,
    String? filter,
    String? error,
  }) {
    return ConversationsState(
      items: items ?? this.items,
      loading: loading ?? this.loading,
      query: query ?? this.query,
      filter: filter ?? this.filter,
      error: error,
    );
  }
}

class ConversationsController extends StateNotifier<ConversationsState> {
  ConversationsController(this._ref) : super(const ConversationsState()) {
    _sub = _ref.read(chatSocketProvider).events.listen(_onEvent);
    load();
  }

  final Ref _ref;
  StreamSubscription<Map<String, dynamic>>? _sub;

  Future<void> load() async {
    try {
      final data = await _ref.read(apiClientProvider).get<Map<String, dynamic>>(
        '/api/v1/conversations',
        query: {'limit': 100},
      );
      final rows = ((data['data'] as List?) ?? []).cast<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
      state = state.copyWith(items: sortConversations(rows), loading: false, error: null);
    } catch (error) {
      state = state.copyWith(loading: false, error: error.toString());
    }
  }

  void setQuery(String value) => state = state.copyWith(query: value);
  void setFilter(String value) => state = state.copyWith(filter: value);

  String titleOf(Map<String, dynamic> conversation) {
    if (conversation['type'] == 'group') {
      final title = (conversation['title'] as String?)?.trim();
      return (title == null || title.isEmpty) ? 'Group' : title;
    }
    final me = _ref.read(authControllerProvider).user?.id;
    final members = (conversation['members'] as List?) ?? [];
    for (final member in members) {
      if (member is Map && member['id'] != me) {
        final full = (member['fullName'] as String?)?.trim() ?? '';
        final display = (member['displayName'] as String?)?.trim() ?? '';
        return full.isNotEmpty ? full : (display.isNotEmpty ? display : 'Chat');
      }
    }
    return 'Direct message';
  }

  Map<String, dynamic>? peer(Map<String, dynamic> conversation) {
    final me = _ref.read(authControllerProvider).user?.id;
    final members = (conversation['members'] as List?) ?? [];
    for (final member in members) {
      if (member is Map && member['id'] != me) return Map<String, dynamic>.from(member);
    }
    return null;
  }

  void _onEvent(Map<String, dynamic> event) {
    final name = event['event'] as String? ?? '';
    final data = (event['data'] as Map?)?.cast<String, dynamic>() ?? {};
    if (name == 'session.revoked') {
      _ref.read(authControllerProvider.notifier).logout();
      return;
    }
    if (name == 'presence.updated') {
      final online = {..._ref.read(onlineUsersProvider)};
      if (data['online'] == true) {
        online.add(data['userId'] as String);
      } else {
        online.remove(data['userId'] as String);
      }
      _ref.read(onlineUsersProvider.notifier).state = online;
      return;
    }
    if (name == 'typing.updated') {
      final conversationId = data['conversationId'] as String?;
      final userId = data['userId'] as String?;
      if (conversationId == null || userId == null) return;
      final current = {..._ref.read(typingProvider)};
      final set = {...(current[conversationId] ?? <String>{})};
      if (data['typing'] == true) {
        set.add(userId);
      } else {
        set.remove(userId);
      }
      current[conversationId] = set;
      _ref.read(typingProvider.notifier).state = current;
      return;
    }
    if (name == 'message.created' || name == 'message.updated' || name == 'message.deleted') {
      _touch(data, created: name == 'message.created');
      return;
    }
    if (name == 'receipt.updated') {
      final me = _ref.read(authControllerProvider).user?.id;
      if (data['userId'] == me && data['conversationId'] is String) {
        _patch(data['conversationId'] as String, (row) => {...row, 'unreadCount': 0});
      }
      return;
    }
    if (name == 'user.updated') {
      final userId = data['userId'];
      final hasPhoto = data['hasProfilePhoto'] == true;
      final version = data['photoVersion']?.toString();
      if (userId == _ref.read(authControllerProvider).user?.id) {
        _ref.read(authControllerProvider.notifier).refreshProfile();
      }
      state = state.copyWith(
        items: [
          for (final row in state.items)
            {
              ...row,
              'members': ((row['members'] as List?) ?? []).map((member) {
                if (member is Map && member['id'] == userId) {
                  return {
                    ...Map<String, dynamic>.from(member),
                    'hasProfilePhoto': hasPhoto,
                    'photoVersion': version,
                    'profilePhotoUrl': null,
                  };
                }
                return member;
              }).toList(),
            },
        ],
      );
      return;
    }
    if (name.startsWith('conversation.') || name.startsWith('group.') || name == 'connection.ready') {
      load();
    }
  }

  void _touch(Map<String, dynamic> message, {required bool created}) {
    final conversationId = message['conversationId'] as String?;
    if (conversationId == null) return;
    final me = _ref.read(authControllerProvider).user?.id;
    final viewing = _ref.read(viewedConversationProvider) == conversationId;
    final incoming = created && message['senderId'] != null && message['senderId'] != me && !viewing;
    final rows = [...state.items];
    final index = rows.indexWhere((row) => row['id'] == conversationId);
    if (index == -1) {
      load();
      return;
    }
    final current = rows.removeAt(index);
    final unread = incoming ? ((current['unreadCount'] as num?) ?? 0) + 1 : current['unreadCount'];
    final next = {
      ...current,
      'latestMessage': created ? message : current['latestMessage'],
      'unreadCount': unread,
      'updatedAt': message['createdAt'] ?? current['updatedAt'],
    };
    state = state.copyWith(items: sortConversations([next, ...rows]));
  }

  void _patch(String id, Map<String, dynamic> Function(Map<String, dynamic>) update) {
    state = state.copyWith(
      items: [
        for (final row in state.items)
          if (row['id'] == id) update(row) else row,
      ],
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

final conversationsControllerProvider =
    StateNotifierProvider<ConversationsController, ConversationsState>((ref) {
  return ConversationsController(ref);
});
