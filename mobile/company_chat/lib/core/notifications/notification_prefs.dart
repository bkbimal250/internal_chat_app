import 'package:company_chat/app/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class NotificationPrefs {
  const NotificationPrefs({
    this.messagesEnabled = true,
    this.sound = true,
    this.vibration = true,
    this.showPreview = true,
    this.showSenderOnLockScreen = true,
    this.groupNotifications = true,
    this.retentionReminders = true,
    this.mutedConversationIds = const [],
  });

  final bool messagesEnabled;
  final bool sound;
  final bool vibration;
  final bool showPreview;
  final bool showSenderOnLockScreen;
  final bool groupNotifications;
  final bool retentionReminders;
  final List<String> mutedConversationIds;

  bool isMuted(String? conversationId) {
    return conversationId != null && mutedConversationIds.contains(conversationId);
  }

  NotificationPrefs copyWith({
    bool? messagesEnabled,
    bool? sound,
    bool? vibration,
    bool? showPreview,
    bool? showSenderOnLockScreen,
    bool? groupNotifications,
    bool? retentionReminders,
    List<String>? mutedConversationIds,
  }) {
    return NotificationPrefs(
      messagesEnabled: messagesEnabled ?? this.messagesEnabled,
      sound: sound ?? this.sound,
      vibration: vibration ?? this.vibration,
      showPreview: showPreview ?? this.showPreview,
      showSenderOnLockScreen: showSenderOnLockScreen ?? this.showSenderOnLockScreen,
      groupNotifications: groupNotifications ?? this.groupNotifications,
      retentionReminders: retentionReminders ?? this.retentionReminders,
      mutedConversationIds: mutedConversationIds ?? this.mutedConversationIds,
    );
  }

  factory NotificationPrefs.fromJson(Map<String, dynamic> json) {
    return NotificationPrefs(
      messagesEnabled: json['messagesEnabled'] != false,
      sound: json['sound'] != false,
      vibration: json['vibration'] != false,
      showPreview: json['showPreview'] != false,
      showSenderOnLockScreen: json['showSenderOnLockScreen'] != false,
      groupNotifications: json['groupNotifications'] != false,
      retentionReminders: json['retentionReminders'] != false,
      mutedConversationIds: ((json['mutedConversationIds'] as List?) ?? []).whereType<String>().toList(),
    );
  }
}

class NotificationPrefsController extends StateNotifier<NotificationPrefs> {
  NotificationPrefsController(this._ref) : super(const NotificationPrefs());

  final Ref _ref;

  Future<void> load() async {
    try {
      final data = await _ref.read(apiClientProvider).get<Map<String, dynamic>>('/api/v1/notification-preferences');
      state = NotificationPrefs.fromJson(data);
    } catch (_) {}
  }

  Future<void> update(NotificationPrefs next) async {
    state = next;
    await _ref.read(apiClientProvider).patch('/api/v1/notification-preferences', data: {
      'messagesEnabled': next.messagesEnabled,
      'sound': next.sound,
      'vibration': next.vibration,
      'showPreview': next.showPreview,
      'showSenderOnLockScreen': next.showSenderOnLockScreen,
      'groupNotifications': next.groupNotifications,
      'retentionReminders': next.retentionReminders,
    });
  }

  Future<void> setMuted(String conversationId, bool muted) async {
    await _ref.read(apiClientProvider).post(
      '/api/v1/conversations/$conversationId/mute',
      data: {'muted': muted},
    );
    _applyMuted([conversationId], muted);
  }

  Future<ConversationMuteResult> setMutedMany(Iterable<String> ids, bool muted) async {
    final unique = [...{for (final id in ids) if (id.isNotEmpty) id}];
    if (unique.isEmpty) return const ConversationMuteResult();
    try {
      final body = await _ref.read(apiClientProvider).post<Map<String, dynamic>>(
        '/api/v1/conversations/mute',
        data: {'conversationIds': unique, 'muted': muted},
      );
      final updated = [
        for (final row in (body['muted'] as List?) ?? const [])
          if (row is Map && (row['conversationId'] ?? row['id']) is String)
            (row['conversationId'] ?? row['id']) as String,
      ];
      final failed = [
        for (final row in (body['failed'] as List?) ?? const [])
          if (row is Map && row['id'] is String) row['id'] as String,
      ];
      _applyMuted(updated, muted);
      return ConversationMuteResult(updated: updated, failed: failed);
    } catch (_) {
      final updated = <String>[];
      final failed = <String>[];
      for (final id in unique) {
        try {
          await setMuted(id, muted);
          updated.add(id);
        } catch (_) {
          failed.add(id);
        }
      }
      return ConversationMuteResult(updated: updated, failed: failed);
    }
  }

  void _applyMuted(Iterable<String> ids, bool muted) {
    final next = {...state.mutedConversationIds};
    for (final id in ids) {
      if (muted) {
        next.add(id);
      } else {
        next.remove(id);
      }
    }
    state = state.copyWith(mutedConversationIds: next.toList());
  }
}

class ConversationMuteResult {
  const ConversationMuteResult({this.updated = const [], this.failed = const []});

  final List<String> updated;
  final List<String> failed;
}

final notificationPrefsProvider =
    StateNotifierProvider<NotificationPrefsController, NotificationPrefs>((ref) {
  return NotificationPrefsController(ref);
});
