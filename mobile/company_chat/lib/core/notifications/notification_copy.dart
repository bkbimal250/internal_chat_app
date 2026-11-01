class NotificationCopy {
  const NotificationCopy({required this.title, required this.body});

  final String title;
  final String body;
}

String senderLabel(Map<String, dynamic>? user) {
  final full = (user?['fullName'] as String?)?.trim() ?? '';
  final display = (user?['displayName'] as String?)?.trim() ?? '';
  if (full.isNotEmpty) return full;
  if (display.isNotEmpty) return display;
  return 'Colleague';
}

NotificationCopy messageNotificationCopy({
  required bool isGroup,
  String? groupTitle,
  required String senderName,
  required String preview,
  bool showPreview = true,
}) {
  if (!showPreview) {
    return NotificationCopy(
      title: 'Company Chat',
      body: isGroup ? 'New group message' : 'New message',
    );
  }
  if (isGroup) {
    return NotificationCopy(
      title: (groupTitle == null || groupTitle.isEmpty) ? 'Group' : groupTitle,
      body: '$senderName: $preview',
    );
  }
  return NotificationCopy(title: senderName.isEmpty ? 'Colleague' : senderName, body: preview);
}
