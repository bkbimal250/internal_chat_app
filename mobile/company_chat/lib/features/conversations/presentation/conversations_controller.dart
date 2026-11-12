import 'dart:async';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/notifications/notification_prefs.dart';
import 'package:company_chat/core/notifications/notify_incoming.dart';
import 'package:company_chat/core/utils/preview_text.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/conversations/conversation_actions.dart';
import 'package:company_chat/features/conversations/conversation_hide.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class ConversationsState {
  const ConversationsState({
    this.items = const [],
    this.archivedItems = const [],
    this.loading = true,
    this.loadingMore = false,
    this.hasMore = true,
    this.query = '',
    this.filter = 'all',
    this.error,
  });

  final List<Map<String, dynamic>> items;
  final List<Map<String, dynamic>> archivedItems;
  final bool loading;
  final bool loadingMore;
  final bool hasMore;
  final String query;
  final String filter;
  final String? error;

  List<Map<String, dynamic>> get source => filter == 'archived' ? archivedItems : items;

  List<Map<String, dynamic>> get visible {
    final needle = query.trim().toLowerCase();
    final filtered = source.where((row) {
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
    List<Map<String, dynamic>>? archivedItems,
    bool? loading,
    bool? loadingMore,
    bool? hasMore,
    String? query,
    String? filter,
    String? error,
  }) {
    return ConversationsState(
      items: items ?? this.items,
      archivedItems: archivedItems ?? this.archivedItems,
      loading: loading ?? this.loading,
      loadingMore: loadingMore ?? this.loadingMore,
      hasMore: hasMore ?? this.hasMore,
      query: query ?? this.query,
      filter: filter ?? this.filter,
      error: error,
    );
  }
}

class ConversationsController extends StateNotifier<ConversationsState> {
  ConversationsController(this._ref) : super(const ConversationsState()) {
    _sub = _ref.read(chatSocketProvider).events.listen(_onEvent);
    _userSub = _ref.listen<String?>(currentUserIdProvider, (previous, next) {
      if (previous == next) return;
      _epoch++;
      _inflight = null;
      _archivedCursor = null;
      _archivedHasMore = true;
      state = ConversationsState(loading: next != null && next.isNotEmpty);
      if (next != null && next.isNotEmpty) load();
    });
    final userId = _ref.read(currentUserIdProvider) ?? _ref.read(authControllerProvider).user?.id;
    if (userId != null && userId.isNotEmpty) load();
  }

  final Ref _ref;
  StreamSubscription<Map<String, dynamic>>? _sub;
  ProviderSubscription<String?>? _userSub;
  Timer? _searchDebounce;
  Timer? _persistDebounce;
  String? _cursor;
  String? _archivedCursor;
  int _epoch = 0;
  Future<void>? _inflight;
  var _disposed = false;
  var _archivedHasMore = true;

  String? get _userId => _ref.read(currentUserIdProvider) ?? _ref.read(authControllerProvider).user?.id;

  Future<void> load({bool more = false}) {
    if (state.filter == 'archived') return _loadArchived(more: more);
    if (more) return _load(more: true);
    return _inflight ??= _load().whenComplete(() => _inflight = null);
  }

  Future<void> _load({bool more = false}) async {
    if (more) {
      if (!state.hasMore || state.loadingMore || _cursor == null) return;
      state = state.copyWith(loadingMore: true);
    } else {
      _cursor = null;
    }
    final epoch = _epoch;
    final userId = _userId;
    if (!more && userId != null && state.items.isEmpty) {
      final cached = await _ref.read(conversationListStoreProvider).load(userId);
      if (_disposed || epoch != _epoch) return;
      if (cached.isNotEmpty) {
        final inbox = cached.where((row) => !isArchived(row)).toList();
        final archived = cached.where(isArchived).toList();
        state = state.copyWith(
          items: sortConversations(inbox),
          archivedItems: sortConversations(archived),
          loading: true,
          error: null,
        );
      }
    }
    try {
      final data = await _ref.read(apiClientProvider).get<Map<String, dynamic>>(
        '/api/v1/conversations',
        query: {
          'limit': 40,
          if (more && _cursor != null) 'cursor': _cursor,
        },
      );
      if (_disposed || epoch != _epoch) return;
      final rows = ((data['data'] as List?) ?? []).cast<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
      _cursor = data['nextCursor'] as String?;
      final merged = more ? _merge(state.items, rows) : rows;
      state = state.copyWith(
        items: sortConversations(merged),
        loading: false,
        loadingMore: false,
        hasMore: _cursor != null,
        error: null,
      );
      if (!more) await _persistAll(userId);
    } catch (error) {
      if (_disposed || epoch != _epoch) return;
      state = state.copyWith(
        loading: false,
        loadingMore: false,
        error: state.items.isEmpty ? error.toString() : null,
      );
    }
  }

  Future<void> _loadArchived({bool more = false}) async {
    if (more) {
      if (!_archivedHasMore || state.loadingMore || _archivedCursor == null) return;
      state = state.copyWith(loadingMore: true);
    }
    final epoch = _epoch;
    final userId = _userId;
    try {
      final data = await _ref.read(apiClientProvider).get<Map<String, dynamic>>(
        '/api/v1/conversations',
        query: {
          'limit': 40,
          'archived': true,
          if (more && _archivedCursor != null) 'cursor': _archivedCursor,
        },
      );
      if (_disposed || epoch != _epoch) return;
      final rows = ((data['data'] as List?) ?? []).cast<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
      _archivedCursor = data['nextCursor'] as String?;
      _archivedHasMore = _archivedCursor != null;
      final merged = more ? _merge(state.archivedItems, rows) : rows;
      state = state.copyWith(
        archivedItems: sortConversations(merged),
        loading: false,
        loadingMore: false,
        error: null,
      );
      await _persistAll(userId);
    } catch (error) {
      if (_disposed || epoch != _epoch) return;
      state = state.copyWith(
        loading: false,
        loadingMore: false,
        error: state.archivedItems.isEmpty ? error.toString() : null,
      );
    }
  }

  Future<ConversationHideResult> hideConversations(Iterable<String> ids) async {
    final unique = [...{for (final id in ids) if (id.isNotEmpty) id}];
    if (unique.isEmpty) return ConversationHideResult.empty;
    final previousInbox = [for (final row in state.items) Map<String, dynamic>.from(row)];
    final previousArchived = [for (final row in state.archivedItems) Map<String, dynamic>.from(row)];
    _epoch++;
    _inflight = null;
    final epoch = _epoch;
    state = state.copyWith(
      items: previousInbox.where((row) => !unique.contains(row['id'])).toList(),
      archivedItems: previousArchived.where((row) => !unique.contains(row['id'])).toList(),
      error: null,
    );
    await _persistAll(_userId);
    try {
      final body = unique.length == 1
          ? await _ref.read(apiClientProvider).post<Map<String, dynamic>>(
              '/api/v1/conversations/${unique.first}/hide',
            )
          : await _ref.read(apiClientProvider).post<Map<String, dynamic>>(
              '/api/v1/conversations/hide',
              data: {'conversationIds': unique},
            );
      final result = ConversationHideResult.parse(body, requested: unique);
      for (final id in result.hiddenIds) {
        await _ref.read(conversationCacheClearerProvider)(id);
      }
      if (epoch != _epoch) return result;
      state = state.copyWith(
        items: sortConversations(applyHideToList(current: state.items, previous: previousInbox, result: result)),
        archivedItems: sortConversations(
          applyHideToList(current: state.archivedItems, previous: previousArchived, result: result),
        ),
        error: result.failed.isEmpty ? null : result.errorMessage,
      );
      await _persistAll(_userId);
      return result;
    } catch (error) {
      if (epoch != _epoch) {
        return ConversationHideResult.failedAll(unique, error.toString());
      }
      state = state.copyWith(
        items: sortConversations(previousInbox),
        archivedItems: sortConversations(previousArchived),
        error: error.toString(),
      );
      await _persistAll(_userId);
      return ConversationHideResult.failedAll(unique, error.toString());
    }
  }

  Future<ConversationBulkResult> pinConversations(Iterable<String> ids, {required bool pinned}) {
    return _mutate(
      ids,
      path: '/api/v1/conversations/pin',
      singlePath: (id) => '/api/v1/conversations/$id/pin',
      data: {'pinned': pinned},
      key: 'pinned',
      action: pinned ? 'pin' : 'unpin',
      merge: (row, update) => {
        ...row,
        'pinnedAt': pinned ? (update['pinnedAt'] ?? DateTime.now().toIso8601String()) : null,
        'archivedAt': pinned ? null : row['archivedAt'],
      },
    );
  }

  Future<ConversationBulkResult> archiveConversations(Iterable<String> ids, {required bool archived}) {
    return _mutate(
      ids,
      path: '/api/v1/conversations/archive',
      singlePath: (id) => '/api/v1/conversations/$id/archive',
      data: {'archived': archived},
      key: 'archived',
      action: archived ? 'archive' : 'unarchive',
      merge: (row, update) => {
        ...row,
        'archivedAt': archived ? (update['archivedAt'] ?? DateTime.now().toIso8601String()) : null,
        'pinnedAt': archived ? null : row['pinnedAt'],
      },
    );
  }

  Future<ConversationBulkResult> markConversationsRead(Iterable<String> ids) {
    return _mutate(
      ids,
      path: '/api/v1/conversations/read',
      singlePath: (id) => '/api/v1/conversations/$id/read',
      data: null,
      key: 'read',
      action: 'mark',
      merge: (row, update) => {...row, 'unreadCount': 0, 'lastReadSeq': update['lastReadSeq'] ?? row['lastMessageSeq']},
      singleBody: (row) => {'sequenceNumber': (row['lastMessageSeq'] as num?)?.toInt() ?? conversationSeq(row)},
    );
  }

  Future<ConversationBulkResult> markConversationsUnread(Iterable<String> ids) {
    return _mutate(
      ids,
      path: '/api/v1/conversations/unread',
      singlePath: (id) => '/api/v1/conversations/$id/unread',
      data: {},
      key: 'unread',
      action: 'mark',
      merge: (row, update) => {
        ...row,
        'unreadCount': ((row['unreadCount'] as num?) ?? 0) > 0 ? row['unreadCount'] : 1,
        'lastReadSeq': update['lastReadSeq'] ?? row['lastReadSeq'],
      },
    );
  }

  Future<ConversationMuteResult> muteConversations(Iterable<String> ids, {required bool muted}) async {
    final unique = [...{for (final id in ids) if (id.isNotEmpty) id}];
    if (unique.isEmpty) return const ConversationMuteResult();
    final result = await _ref.read(notificationPrefsProvider.notifier).setMutedMany(unique, muted);
    final stamp = muted ? DateTime.utc(9999, 12, 31).toIso8601String() : null;
    Map<String, dynamic> patch(Map<String, dynamic> row) {
      return result.updated.contains(row['id']) ? {...row, 'mutedUntil': stamp} : row;
    }
    state = state.copyWith(
      items: [for (final row in state.items) patch(row)],
      archivedItems: [for (final row in state.archivedItems) patch(row)],
      error: result.failed.isEmpty ? null : "Couldn't update mute for ${result.failed.length} chat${result.failed.length == 1 ? '' : 's'}.",
    );
    await _persistAll(_userId);
    return result;
  }

  Future<ConversationBulkResult> _mutate(
    Iterable<String> ids, {
    required String path,
    required String Function(String id) singlePath,
    required Map<String, dynamic>? data,
    required String key,
    required String action,
    required Map<String, dynamic> Function(Map<String, dynamic> row, Map<String, dynamic> update) merge,
    Map<String, dynamic> Function(Map<String, dynamic> row)? singleBody,
  }) async {
    final unique = [...{for (final id in ids) if (id.isNotEmpty) id}];
    if (unique.isEmpty) return ConversationBulkResult.empty;
    final previousInbox = [for (final row in state.items) Map<String, dynamic>.from(row)];
    final previousArchived = [for (final row in state.archivedItems) Map<String, dynamic>.from(row)];
    final lookup = {
      for (final row in [...previousInbox, ...previousArchived]) row['id'] as String: row,
    };
    _epoch++;
    _inflight = null;
    final epoch = _epoch;
    final optimistic = ConversationBulkResult(
      updated: [for (final id in unique) if (lookup[id] != null) merge(lookup[id]!, {'id': id})],
    );
    _applyBulk(optimistic, merge: merge);
    await _persistAll(_userId);
    try {
      late final Map<String, dynamic> body;
      if (unique.length == 1 && singleBody != null) {
        final row = lookup[unique.first] ?? {'id': unique.first};
        final reply = await _ref.read(apiClientProvider).post<Map<String, dynamic>>(
          singlePath(unique.first),
          data: singleBody(row),
        );
        body = {'id': unique.first, ...reply};
      } else if (unique.length == 1) {
        final reply = await _ref.read(apiClientProvider).post<Map<String, dynamic>>(
          singlePath(unique.first),
          data: data,
        );
        body = {'id': unique.first, ...reply};
      } else {
        body = await _ref.read(apiClientProvider).post<Map<String, dynamic>>(
          path,
          data: {'conversationIds': unique, ...?data},
        );
      }
      final result = ConversationBulkResult.parse(body, requested: unique, key: key);
      if (epoch != _epoch) return result;
      _applyBulk(result, merge: merge, previousInbox: previousInbox, previousArchived: previousArchived);
      state = state.copyWith(error: result.failed.isEmpty ? null : result.errorMessage(action));
      await _persistAll(_userId);
      return result;
    } catch (error) {
      if (epoch != _epoch) {
        return ConversationBulkResult.failedAll(unique, error.toString());
      }
      state = state.copyWith(
        items: sortConversations(previousInbox),
        archivedItems: sortConversations(previousArchived),
        error: error.toString(),
      );
      await _persistAll(_userId);
      return ConversationBulkResult.failedAll(unique, error.toString());
    }
  }

  void _applyBulk(
    ConversationBulkResult result, {
    required Map<String, dynamic> Function(Map<String, dynamic> row, Map<String, dynamic> update) merge,
    List<Map<String, dynamic>>? previousInbox,
    List<Map<String, dynamic>>? previousArchived,
  }) {
    final inbox = applyBulkToList(
      current: state.items,
      previous: previousInbox ?? state.items,
      result: result,
      merge: merge,
      keep: (row) => !isArchived(row),
    );
    var archived = applyBulkToList(
      current: state.archivedItems,
      previous: previousArchived ?? state.archivedItems,
      result: result,
      merge: merge,
      keep: isArchived,
    );
    final inboxIds = {for (final row in inbox) row['id']};
    final known = [
      ...state.items,
      ...state.archivedItems,
      ...(previousInbox ?? const []),
      ...(previousArchived ?? const []),
    ];
    for (final row in result.updated) {
      final id = row['id'] as String?;
      if (id == null) continue;
      Map<String, dynamic>? merged;
      for (final item in known) {
        if (item['id'] == id) {
          merged = item;
          break;
        }
      }
      if (merged == null) continue;
      final next = merge(merged, row);
      if (isArchived(next)) {
        if (!archived.any((item) => item['id'] == id)) archived.add(next);
      } else if (!inboxIds.contains(id)) {
        inbox.add(next);
      }
    }
    state = state.copyWith(
      items: sortConversations(inbox),
      archivedItems: sortConversations(archived),
    );
  }

  void setQuery(String value) {
    _searchDebounce?.cancel();
    if (value.trim().isEmpty) {
      state = state.copyWith(query: '');
      return;
    }
    _searchDebounce = Timer(const Duration(milliseconds: 140), () {
      state = state.copyWith(query: value);
    });
  }

  void setFilter(String value) {
    if (value == state.filter) return;
    state = state.copyWith(filter: value);
    if (value == 'archived') unawaited(_loadArchived());
  }

  List<Map<String, dynamic>> _merge(List<Map<String, dynamic>> current, List<Map<String, dynamic>> incoming) {
    final byId = {for (final row in current) row['id']: row};
    for (final row in incoming) {
      byId[row['id']] = row;
    }
    return byId.values.toList();
  }

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
      final me = _ref.read(authControllerProvider).user?.id;
      if (userId == me) return;
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
    final viewing = isActivelyViewingChat(
      conversationId: conversationId,
      viewedConversationId: _ref.read(viewedConversationProvider),
      lifecycle: _ref.read(appLifecycleProvider),
    );
    final incoming = created && message['senderId'] != null && message['senderId'] != me && !viewing;
    final inbox = [...state.items];
    final archived = [...state.archivedItems];
    final inboxIndex = inbox.indexWhere((row) => row['id'] == conversationId);
    final archivedIndex = archived.indexWhere((row) => row['id'] == conversationId);
    if (inboxIndex == -1 && archivedIndex == -1) {
      load();
      return;
    }
    final fromArchived = archivedIndex != -1;
    final rows = fromArchived ? archived : inbox;
    final index = fromArchived ? archivedIndex : inboxIndex;
    final current = rows.removeAt(index);
    final unread = incoming ? ((current['unreadCount'] as num?) ?? 0) + 1 : current['unreadCount'];
    final next = {
      ...current,
      'latestMessage': created ? message : current['latestMessage'],
      'unreadCount': unread,
      'updatedAt': message['createdAt'] ?? current['updatedAt'],
    };
    if (fromArchived) {
      state = state.copyWith(archivedItems: sortConversations([next, ...rows]));
    } else {
      state = state.copyWith(items: sortConversations([next, ...rows]));
    }
    _schedulePersist();
  }

  void _patch(String id, Map<String, dynamic> Function(Map<String, dynamic>) update) {
    state = state.copyWith(
      items: [
        for (final row in state.items)
          if (row['id'] == id) update(row) else row,
      ],
      archivedItems: [
        for (final row in state.archivedItems)
          if (row['id'] == id) update(row) else row,
      ],
    );
    _schedulePersist();
  }

  void _schedulePersist() {
    _persistDebounce?.cancel();
    _persistDebounce = Timer(const Duration(milliseconds: 400), () {
      unawaited(_persistAll(_userId));
    });
  }

  Future<void> _persistAll(String? userId) {
    return _ref.read(conversationListStoreProvider).save(userId, [...state.items, ...state.archivedItems]);
  }

  @override
  void dispose() {
    _disposed = true;
    _searchDebounce?.cancel();
    _persistDebounce?.cancel();
    _userSub?.close();
    _sub?.cancel();
    super.dispose();
  }
}

final conversationsControllerProvider =
    StateNotifierProvider<ConversationsController, ConversationsState>((ref) {
  return ConversationsController(ref);
});
