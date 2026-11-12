import 'package:company_chat/core/utils/preview_text.dart';

const messageMutateWindow = Duration(minutes: 15);

bool _isGone(Map<String, dynamic> message) {
  return message['deletedAt'] != null || message['expiredAt'] != null || message['pending'] == true;
}

bool isSystemMessage(Map<String, dynamic> message) {
  return message['messageType'] == 'system';
}

bool isSelectableMessage(Map<String, dynamic> message) {
  return !isSystemMessage(message) && (message['id'] as String?)?.isNotEmpty == true;
}

bool canReplyToMessage(Map<String, dynamic> message) {
  return !isSystemMessage(message) && !_isGone(message);
}

bool canCopyMessage(Map<String, dynamic> message) {
  final content = (message['content'] as String?)?.trim() ?? '';
  return content.isNotEmpty && !isSystemMessage(message) && message['deletedAt'] == null && message['expiredAt'] == null && message['pending'] != true;
}

bool canForwardMessage(Map<String, dynamic> message) {
  return canReplyToMessage(message);
}

bool canDeleteForMe(Map<String, dynamic> message) {
  return !isSystemMessage(message) && message['pending'] != true && message['expiredAt'] == null;
}

bool canMutateMessage(Map<String, dynamic> message, String? currentUserId, {DateTime? now}) {
  if (currentUserId == null || message['senderId'] != currentUserId) return false;
  if (_isGone(message) || isSystemMessage(message)) return false;
  final created = DateTime.tryParse(message['createdAt']?.toString() ?? '');
  if (created == null) return false;
  return (now ?? DateTime.now()).toUtc().difference(created.toUtc()) <= messageMutateWindow;
}

bool canDeleteForEveryone(
  Map<String, dynamic> message, {
  required String? currentUserId,
  required String? conversationType,
  DateTime? now,
}) {
  return conversationType == 'direct' && canMutateMessage(message, currentUserId, now: now);
}

bool canShareText(Map<String, dynamic> message) => canCopyMessage(message);

bool canShareFiles(Map<String, dynamic> message) {
  // File/media share stays off until company object storage is approved.
  return false;
}

bool selectionCanReply(List<Map<String, dynamic>> selected) {
  return selected.length == 1 && canReplyToMessage(selected.first);
}

bool selectionCanCopy(List<Map<String, dynamic>> selected) {
  return selected.any(canCopyMessage);
}

bool selectionCanForward(List<Map<String, dynamic>> selected) {
  return selected.any(canForwardMessage);
}

bool selectionCanDelete(List<Map<String, dynamic>> selected) {
  return selected.any(canDeleteForMe);
}

bool selectionCanShare(List<Map<String, dynamic>> selected) {
  return selected.any(canShareText);
}

bool selectionCanDeleteForEveryone(
  List<Map<String, dynamic>> selected, {
  required String? currentUserId,
  required String? conversationType,
  DateTime? now,
}) {
  if (selected.isEmpty) return false;
  return selected.every(
    (message) => canDeleteForEveryone(message, currentUserId: currentUserId, conversationType: conversationType, now: now),
  );
}

String copyText(Map<String, dynamic> message) {
  if (!canCopyMessage(message)) return '';
  return (message['content'] as String?)?.trim() ?? '';
}

String copySelectedText(List<Map<String, dynamic>> selected) {
  return selected.map(copyText).where((row) => row.isNotEmpty).join('\n\n');
}

String forwardContent(Map<String, dynamic> message) {
  final content = (message['content'] as String?)?.trim() ?? '';
  if (content.isNotEmpty) return content;
  return previewText(message);
}
