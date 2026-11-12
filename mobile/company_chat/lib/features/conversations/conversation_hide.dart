class HiddenChat {
  const HiddenChat({required this.id, required this.hiddenUntilSeq});

  final String id;
  final int hiddenUntilSeq;
}

class ConversationHideFailure {
  const ConversationHideFailure({required this.id, this.code, this.message});

  final String id;
  final String? code;
  final String? message;
}

class ConversationHideResult {
  const ConversationHideResult({
    this.hidden = const [],
    this.failed = const [],
  });

  static const empty = ConversationHideResult();

  final List<HiddenChat> hidden;
  final List<ConversationHideFailure> failed;

  List<String> get hiddenIds => [for (final row in hidden) row.id];
  List<String> get failedIds => [for (final row in failed) row.id];
  bool get succeeded => hidden.isNotEmpty && failed.isEmpty;
  bool get partial => hidden.isNotEmpty && failed.isNotEmpty;

  String get errorMessage {
    if (failed.isEmpty) return '';
    if (hidden.isEmpty) {
      return failed.length == 1
          ? (failed.first.message ?? "Couldn't delete that chat. Try again.")
          : "Couldn't delete the selected chats. Try again.";
    }
    return 'Deleted ${hidden.length} chat${hidden.length == 1 ? '' : 's'}. ${failed.length} could not be deleted.';
  }

  factory ConversationHideResult.failedAll(Iterable<String> ids, String message) {
    return ConversationHideResult(
      failed: [for (final id in ids) ConversationHideFailure(id: id, message: message)],
    );
  }

  factory ConversationHideResult.parse(Map<String, dynamic> body, {required List<String> requested}) {
    if (body['id'] is String) {
      return ConversationHideResult(
        hidden: [
          HiddenChat(
            id: body['id'] as String,
            hiddenUntilSeq: (body['hiddenUntilSeq'] as num?)?.toInt() ?? 0,
          ),
        ],
      );
    }
    final hidden = <HiddenChat>[];
    for (final row in (body['hidden'] as List?) ?? const []) {
      if (row is String) {
        hidden.add(HiddenChat(id: row, hiddenUntilSeq: 0));
      } else if (row is Map) {
        final id = row['id'] as String?;
        if (id == null) continue;
        hidden.add(HiddenChat(id: id, hiddenUntilSeq: (row['hiddenUntilSeq'] as num?)?.toInt() ?? 0));
      }
    }
    final failed = <ConversationHideFailure>[];
    for (final row in (body['failed'] as List?) ?? const []) {
      if (row is! Map) continue;
      final id = row['id'] as String?;
      if (id == null) continue;
      failed.add(
        ConversationHideFailure(
          id: id,
          code: row['code'] as String?,
          message: row['message'] as String?,
        ),
      );
    }
    if (hidden.isEmpty && failed.isEmpty && requested.isNotEmpty) {
      return ConversationHideResult.failedAll(requested, "Couldn't delete the selected chats. Try again.");
    }
    return ConversationHideResult(hidden: hidden, failed: failed);
  }
}

int conversationSeq(Map<String, dynamic> row) {
  final last = row['lastMessageSeq'];
  if (last is num) return last.toInt();
  final latest = row['latestMessage'];
  if (latest is Map && latest['sequenceNumber'] is num) {
    return (latest['sequenceNumber'] as num).toInt();
  }
  return 0;
}

List<Map<String, dynamic>> applyHideToList({
  required List<Map<String, dynamic>> current,
  required List<Map<String, dynamic>> previous,
  required ConversationHideResult result,
}) {
  final failed = result.failedIds.toSet();
  final hiddenUntil = {for (final row in result.hidden) row.id: row.hiddenUntilSeq};
  final kept = <String, Map<String, dynamic>>{};
  for (final row in current) {
    final id = row['id'] as String?;
    if (id == null) continue;
    final until = hiddenUntil[id];
    if (until != null && conversationSeq(row) <= until) continue;
    kept[id] = row;
  }
  for (final row in previous) {
    final id = row['id'] as String?;
    if (id != null && failed.contains(id)) kept[id] = row;
  }
  return kept.values.toList();
}

String hideChatsTitle(int count) => count == 1 ? 'Delete this chat?' : 'Delete $count chats?';

const hideChatsBody =
    'This removes the chat from your list only. Other people keep it, and you stay in any group. '
    'A new message can make the chat appear again. Older messages stay hidden for you.';
