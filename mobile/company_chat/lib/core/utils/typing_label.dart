String typingLabel(Iterable<String> names) {
  final unique = <String>[];
  for (final name in names) {
    final trimmed = name.trim();
    if (trimmed.isEmpty || unique.contains(trimmed)) continue;
    unique.add(trimmed);
  }
  if (unique.isEmpty) return '';
  if (unique.length == 1) return '${unique.first} is typing...';
  if (unique.length == 2) return '${unique[0]} and ${unique[1]} are typing...';
  return '${unique.length} people are typing...';
}

String remoteTypingLabel({
  required Iterable<String> userIds,
  required List members,
  String? currentUserId,
}) {
  final names = <String>[];
  for (final id in userIds.toSet()) {
    if (id.isEmpty || id == currentUserId) continue;
    Map<String, dynamic>? member;
    for (final row in members.whereType<Map>()) {
      final map = Map<String, dynamic>.from(row);
      if (map['id'] == id) {
        member = map;
        break;
      }
    }
    final name = (member?['displayName'] as String?)?.trim() ?? (member?['fullName'] as String?)?.trim() ?? '';
    if (name.isNotEmpty) names.add(name);
  }
  return typingLabel(names);
}
