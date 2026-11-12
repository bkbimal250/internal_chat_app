import 'package:company_chat/features/conversations/conversation_hide.dart';

class ConversationBulkResult {
  const ConversationBulkResult({
    this.updated = const [],
    this.failed = const [],
  });

  static const empty = ConversationBulkResult();

  final List<Map<String, dynamic>> updated;
  final List<ConversationHideFailure> failed;

  List<String> get updatedIds => [
        for (final row in updated)
          if (row['id'] is String) row['id'] as String,
      ];
  List<String> get failedIds => [for (final row in failed) row.id];
  bool get succeeded => updated.isNotEmpty && failed.isEmpty;
  bool get partial => updated.isNotEmpty && failed.isNotEmpty;

  String errorMessage(String action) {
    if (failed.isEmpty) return '';
    if (updated.isEmpty) {
      return failed.length == 1
          ? (failed.first.message ?? "Couldn't $action that chat. Try again.")
          : "Couldn't $action the selected chats. Try again.";
    }
    return 'Updated ${updated.length} chat${updated.length == 1 ? '' : 's'}. ${failed.length} could not be $action${action.endsWith('e') ? 'd' : 'ed'}.';
  }

  factory ConversationBulkResult.failedAll(Iterable<String> ids, String message) {
    return ConversationBulkResult(
      failed: [for (final id in ids) ConversationHideFailure(id: id, message: message)],
    );
  }

  factory ConversationBulkResult.parse(
    Map<String, dynamic> body, {
    required List<String> requested,
    required String key,
  }) {
    if (body['id'] is String) {
      return ConversationBulkResult(updated: [Map<String, dynamic>.from(body)]);
    }
    final updated = <Map<String, dynamic>>[];
    for (final row in (body[key] as List?) ?? const []) {
      if (row is String) {
        updated.add({'id': row});
      } else if (row is Map) {
        final id = row['id'] as String? ?? row['conversationId'] as String?;
        if (id == null) continue;
        updated.add({'id': id, ...Map<String, dynamic>.from(row)});
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
    if (updated.isEmpty && failed.isEmpty && requested.isNotEmpty) {
      return ConversationBulkResult.failedAll(requested, "Couldn't update the selected chats. Try again.");
    }
    return ConversationBulkResult(updated: updated, failed: failed);
  }
}

class ChatSelectionSnapshot {
  ChatSelectionSnapshot(this.rows);

  final List<Map<String, dynamic>> rows;

  int get count => rows.length;
  bool get isEmpty => rows.isEmpty;
  bool get allPinned => rows.isNotEmpty && rows.every(isPinned);
  bool get anyPinned => rows.any(isPinned);
  bool get allMuted => rows.isNotEmpty && rows.every(isMutedRow);
  bool get anyMuted => rows.any(isMutedRow);
  bool get allArchived => rows.isNotEmpty && rows.every(isArchived);
  bool get anyArchived => rows.any(isArchived);
  bool get anyUnread => rows.any((row) => ((row['unreadCount'] as num?) ?? 0) > 0);
  bool get anyRead => rows.any((row) => ((row['unreadCount'] as num?) ?? 0) <= 0);
}

bool isPinned(Map<String, dynamic> row) {
  final value = row['pinnedAt'];
  return value != null && value.toString().isNotEmpty;
}

bool isArchived(Map<String, dynamic> row) {
  final value = row['archivedAt'];
  return value != null && value.toString().isNotEmpty;
}

bool isMutedRow(Map<String, dynamic> row, {DateTime? now, Set<String>? mutedIds}) {
  final id = row['id'] as String?;
  if (id != null && mutedIds != null && mutedIds.contains(id)) return true;
  final until = DateTime.tryParse(row['mutedUntil']?.toString() ?? '');
  return until != null && until.isAfter(now ?? DateTime.now());
}

List<Map<String, dynamic>> applyBulkToList({
  required List<Map<String, dynamic>> current,
  required List<Map<String, dynamic>> previous,
  required ConversationBulkResult result,
  required Map<String, dynamic> Function(Map<String, dynamic> row, Map<String, dynamic> update) merge,
  bool Function(Map<String, dynamic> row)? keep,
}) {
  final failed = result.failedIds.toSet();
  final updates = {for (final row in result.updated) row['id'] as String: row};
  final byId = <String, Map<String, dynamic>>{};
  for (final row in current) {
    final id = row['id'] as String?;
    if (id == null) continue;
    final update = updates[id];
    final next = update == null ? row : merge(row, update);
    if (keep != null && !keep(next)) continue;
    byId[id] = next;
  }
  for (final row in previous) {
    final id = row['id'] as String?;
    if (id != null && failed.contains(id)) byId[id] = row;
  }
  return byId.values.toList();
}
