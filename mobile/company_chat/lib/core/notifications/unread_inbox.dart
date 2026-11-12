const androidMessagingStyleLimit = 25;

class InboxMessage {
  const InboxMessage({
    required this.id,
    required this.senderId,
    required this.senderName,
    required this.text,
    required this.at,
    this.sequenceNumber = 0,
  });

  final String id;
  final String senderId;
  final String senderName;
  final String text;
  final DateTime at;
  final int sequenceNumber;

  Map<String, dynamic> toJson() => {
        'id': id,
        'senderId': senderId,
        'senderName': senderName,
        'text': text,
        'at': at.toIso8601String(),
        'sequenceNumber': sequenceNumber,
      };

  factory InboxMessage.fromJson(Map<String, dynamic> json) {
    return InboxMessage(
      id: json['id'] as String? ?? '',
      senderId: json['senderId'] as String? ?? '',
      senderName: json['senderName'] as String? ?? 'Colleague',
      text: json['text'] as String? ?? '',
      at: DateTime.tryParse(json['at']?.toString() ?? '') ?? DateTime.now().toUtc(),
      sequenceNumber: (json['sequenceNumber'] as num?)?.toInt() ?? 0,
    );
  }
}

class ConversationThread {
  const ConversationThread({
    required this.conversationId,
    required this.title,
    required this.isGroup,
    this.unreadCount = 0,
    this.messages = const [],
    this.postedNotificationIds = const [],
  });

  final String conversationId;
  final String title;
  final bool isGroup;
  final int unreadCount;
  final List<InboxMessage> messages;
  final List<int> postedNotificationIds;

  List<InboxMessage> get chronological {
    final next = [...messages];
    next.sort((a, b) {
      final seq = a.sequenceNumber.compareTo(b.sequenceNumber);
      if (seq != 0) return seq;
      return a.at.compareTo(b.at);
    });
    return next;
  }

  List<InboxMessage> get visible {
    final sorted = chronological;
    if (sorted.length <= androidMessagingStyleLimit) return sorted;
    return sorted.sublist(sorted.length - androidMessagingStyleLimit);
  }

  int get displayedCount => visible.length;

  int get remainingCount {
    final total = unreadCount > messages.length ? unreadCount : messages.length;
    final leftover = total - displayedCount;
    return leftover < 0 ? 0 : leftover;
  }

  int get badgeCount => unreadCount > messages.length ? unreadCount : messages.length;

  int get latestSequence {
    var max = 0;
    for (final message in messages) {
      if (message.sequenceNumber > max) max = message.sequenceNumber;
    }
    return max;
  }

  InboxMessage? get latest => chronological.isEmpty ? null : chronological.last;

  ConversationThread copyWith({
    String? title,
    bool? isGroup,
    int? unreadCount,
    List<InboxMessage>? messages,
    List<int>? postedNotificationIds,
  }) {
    return ConversationThread(
      conversationId: conversationId,
      title: title ?? this.title,
      isGroup: isGroup ?? this.isGroup,
      unreadCount: unreadCount ?? this.unreadCount,
      messages: messages ?? this.messages,
      postedNotificationIds: postedNotificationIds ?? this.postedNotificationIds,
    );
  }

  Map<String, dynamic> toJson() => {
        'conversationId': conversationId,
        'title': title,
        'isGroup': isGroup,
        'unreadCount': unreadCount,
        'messages': messages.map((row) => row.toJson()).toList(),
        'postedNotificationIds': postedNotificationIds,
      };

  factory ConversationThread.fromJson(Map<String, dynamic> json) {
    return ConversationThread(
      conversationId: json['conversationId'] as String? ?? '',
      title: json['title'] as String? ?? 'MiChat',
      isGroup: json['isGroup'] == true,
      unreadCount: (json['unreadCount'] as num?)?.toInt() ?? 0,
      messages: ((json['messages'] as List?) ?? [])
          .whereType<Map>()
          .map((row) => InboxMessage.fromJson(Map<String, dynamic>.from(row)))
          .where((row) => row.id.isNotEmpty)
          .toList(),
      postedNotificationIds: ((json['postedNotificationIds'] as List?) ?? [])
          .whereType<num>()
          .map((row) => row.toInt())
          .toList(),
    );
  }
}

class UnreadInbox {
  const UnreadInbox({
    this.userId,
    this.showPreview = true,
    this.showSenderOnLockScreen = true,
    this.messagesEnabled = true,
    this.viewedConversationId,
    this.foreground = false,
    this.conversations = const {},
  });

  final String? userId;
  final bool showPreview;
  final bool showSenderOnLockScreen;
  final bool messagesEnabled;
  final String? viewedConversationId;
  final bool foreground;
  final Map<String, ConversationThread> conversations;

  bool get isEmpty => conversations.isEmpty;

  ConversationThread? thread(String conversationId) => conversations[conversationId];

  UnreadInbox bindUser(String? nextUserId) {
    if (nextUserId == null || nextUserId.isEmpty) {
      return const UnreadInbox();
    }
    if (userId == nextUserId) return this;
    return UnreadInbox(
      userId: nextUserId,
      showPreview: showPreview,
      showSenderOnLockScreen: showSenderOnLockScreen,
      messagesEnabled: messagesEnabled,
    );
  }

  UnreadInbox withPrefs({
    bool? showPreview,
    bool? showSenderOnLockScreen,
    bool? messagesEnabled,
  }) {
    return UnreadInbox(
      userId: userId,
      showPreview: showPreview ?? this.showPreview,
      showSenderOnLockScreen: showSenderOnLockScreen ?? this.showSenderOnLockScreen,
      messagesEnabled: messagesEnabled ?? this.messagesEnabled,
      viewedConversationId: viewedConversationId,
      foreground: foreground,
      conversations: conversations,
    );
  }

  UnreadInbox withLifecycle({String? viewedConversationId, bool? foreground, bool clearViewed = false}) {
    return UnreadInbox(
      userId: userId,
      showPreview: showPreview,
      showSenderOnLockScreen: showSenderOnLockScreen,
      messagesEnabled: messagesEnabled,
      viewedConversationId: clearViewed ? null : (viewedConversationId ?? this.viewedConversationId),
      foreground: foreground ?? this.foreground,
      conversations: conversations,
    );
  }

  bool shouldSuppress(String conversationId) {
    return foreground && viewedConversationId == conversationId;
  }

  UnreadInbox addMessage({
    required String conversationId,
    required InboxMessage message,
    required String title,
    required bool isGroup,
    int? unreadCount,
  }) {
    if (message.id.isEmpty || conversationId.isEmpty) return this;
    if (shouldSuppress(conversationId)) return this;
    final existing = conversations[conversationId];
    final current = existing?.messages ?? const <InboxMessage>[];
    if (current.any((row) => row.id == message.id)) {
      return copyWithThread(
        (existing ??
                ConversationThread(
                  conversationId: conversationId,
                  title: title,
                  isGroup: isGroup,
                ))
            .copyWith(
          title: title,
          isGroup: isGroup,
          unreadCount: unreadCount ?? existing?.unreadCount ?? current.length,
        ),
      );
    }
    final nextMessages = [...current, message];
    return copyWithThread(
      ConversationThread(
        conversationId: conversationId,
        title: title,
        isGroup: isGroup,
        unreadCount: unreadCount ?? (existing?.unreadCount ?? current.length) + 1,
        messages: nextMessages,
        postedNotificationIds: existing?.postedNotificationIds ?? const [],
      ),
    );
  }

  UnreadInbox mergeServerMessages({
    required String conversationId,
    required String title,
    required bool isGroup,
    required List<InboxMessage> incoming,
    required int unreadCount,
  }) {
    final existing = conversations[conversationId];
    final byId = <String, InboxMessage>{
      for (final row in existing?.messages ?? const <InboxMessage>[]) row.id: row,
      for (final row in incoming)
        if (row.id.isNotEmpty) row.id: row,
    };
    return copyWithThread(
      ConversationThread(
        conversationId: conversationId,
        title: title,
        isGroup: isGroup,
        unreadCount: unreadCount,
        messages: byId.values.toList(),
        postedNotificationIds: existing?.postedNotificationIds ?? const [],
      ),
    );
  }

  UnreadInbox markPosted(String conversationId, Iterable<int> ids) {
    final existing = conversations[conversationId];
    if (existing == null) return this;
    final next = {...existing.postedNotificationIds};
    next.addAll(ids);
    return copyWithThread(existing.copyWith(postedNotificationIds: next.toList()));
  }

  UnreadInbox clearConversation(String conversationId) {
    if (!conversations.containsKey(conversationId)) return this;
    final next = Map<String, ConversationThread>.from(conversations)..remove(conversationId);
    return UnreadInbox(
      userId: userId,
      showPreview: showPreview,
      showSenderOnLockScreen: showSenderOnLockScreen,
      messagesEnabled: messagesEnabled,
      viewedConversationId: viewedConversationId,
      foreground: foreground,
      conversations: next,
    );
  }

  UnreadInbox copyWithThread(ConversationThread thread) {
    final next = Map<String, ConversationThread>.from(conversations);
    next[thread.conversationId] = thread;
    return UnreadInbox(
      userId: userId,
      showPreview: showPreview,
      showSenderOnLockScreen: showSenderOnLockScreen,
      messagesEnabled: messagesEnabled,
      viewedConversationId: viewedConversationId,
      foreground: foreground,
      conversations: next,
    );
  }

  Map<String, dynamic> toJson() => {
        'userId': userId,
        'showPreview': showPreview,
        'showSenderOnLockScreen': showSenderOnLockScreen,
        'messagesEnabled': messagesEnabled,
        'viewedConversationId': viewedConversationId,
        'foreground': foreground,
        'conversations': conversations.map((key, value) => MapEntry(key, value.toJson())),
      };

  factory UnreadInbox.fromJson(Map<String, dynamic> json) {
    final raw = (json['conversations'] as Map?) ?? {};
    return UnreadInbox(
      userId: json['userId'] as String?,
      showPreview: json['showPreview'] != false,
      showSenderOnLockScreen: json['showSenderOnLockScreen'] != false,
      messagesEnabled: json['messagesEnabled'] != false,
      viewedConversationId: json['viewedConversationId'] as String?,
      foreground: json['foreground'] == true,
      conversations: raw.map(
        (key, value) => MapEntry(
          key.toString(),
          ConversationThread.fromJson(Map<String, dynamic>.from(value as Map)),
        ),
      ),
    );
  }
}

String collapsedNotificationBody(ConversationThread thread, {required bool showPreview}) {
  if (!showPreview) {
    return thread.badgeCount <= 1 ? 'New message' : '${thread.badgeCount} new messages';
  }
  final latest = thread.latest;
  if (latest == null) return 'New message';
  if (thread.isGroup) return '${latest.senderName}: ${latest.text}';
  return latest.text;
}

String displayMessageText(InboxMessage message, {required bool showPreview}) {
  if (!showPreview) return 'New message';
  return message.text;
}

String displaySenderName(InboxMessage message, {required bool showPreview, required bool showSender}) {
  if (!showPreview || !showSender) return 'MiChat';
  return message.senderName;
}

int notificationIdForConversation(String conversationId) => conversationId.hashCode & 0x7fffffff;

int notificationIdForMessage(String messageId) => messageId.hashCode & 0x7fffffff;
