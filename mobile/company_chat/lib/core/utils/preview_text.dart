String previewText(Map<String, dynamic>? message) {
  if (message == null) return 'No messages yet';
  if (message['deletedAt'] != null) return 'Message deleted';
  final type = message['messageType'] as String? ?? 'text';
  final content = (message['content'] as String?) ?? '';
  switch (type) {
    case 'system':
      return content;
    case 'image':
      return content.isEmpty ? 'Photo' : content;
    case 'video':
      return content.isEmpty ? 'Video' : content;
    case 'audio':
      return content.isEmpty ? 'Audio' : content;
    case 'file':
      final name = (message['attachment'] as Map?)?['originalName'] as String?;
      return content.isEmpty ? (name ?? 'File') : content;
    default:
      return content;
  }
}

int conversationActivityAt(Map<String, dynamic> conversation) {
  final latest = conversation['latestMessage'] as Map<String, dynamic>?;
  final raw = latest?['createdAt'] ?? conversation['updatedAt'];
  final parsed = DateTime.tryParse(raw?.toString() ?? '');
  return parsed?.millisecondsSinceEpoch ?? 0;
}

List<Map<String, dynamic>> sortConversations(List<Map<String, dynamic>> rows) {
  final next = [...rows];
  next.sort((a, b) {
    final delta = conversationActivityAt(b) - conversationActivityAt(a);
    if (delta != 0) return delta;
    return (b['id'] ?? '').toString().compareTo((a['id'] ?? '').toString());
  });
  return next;
}
