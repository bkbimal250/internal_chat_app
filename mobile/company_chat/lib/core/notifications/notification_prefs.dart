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
    final ids = {...state.mutedConversationIds};
    if (muted) {
      ids.add(conversationId);
    } else {
      ids.remove(conversationId);
    }
    state = state.copyWith(mutedConversationIds: ids.toList());
  }
}

final notificationPrefsProvider =
    StateNotifierProvider<NotificationPrefsController, NotificationPrefs>((ref) {
  return NotificationPrefsController(ref);
});
