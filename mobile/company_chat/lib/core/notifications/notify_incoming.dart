import 'package:flutter/widgets.dart';

bool isActivelyViewingChat({
  required String conversationId,
  required String? viewedConversationId,
  required AppLifecycleState lifecycle,
}) {
  return lifecycle == AppLifecycleState.resumed &&
      viewedConversationId != null &&
      viewedConversationId == conversationId;
}

bool shouldPresentIncomingNotice({
  required String? senderId,
  required String? currentUserId,
  required String conversationId,
  required String? viewedConversationId,
  required AppLifecycleState lifecycle,
  required String? messageId,
  required Set<String> seenIds,
}) {
  if (conversationId.isEmpty) return false;
  if (senderId == null || senderId == currentUserId) return false;
  if (messageId != null && messageId.isNotEmpty && !seenIds.add(messageId)) return false;
  return !isActivelyViewingChat(
    conversationId: conversationId,
    viewedConversationId: viewedConversationId,
    lifecycle: lifecycle,
  );
}
