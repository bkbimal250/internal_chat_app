const maxCachedMessages = 200;

bool cachedPayloadExpired(Map<String, dynamic> payload, [DateTime? now]) {
  final raw = payload['expiredAt'];
  if (raw == null) return false;
  final at = DateTime.tryParse(raw.toString());
  if (at == null) return true;
  return !at.toUtc().isAfter((now ?? DateTime.now()).toUtc());
}

List<Map<String, dynamic>> capCachedMessages(List<Map<String, dynamic>> messages) {
  if (messages.length <= maxCachedMessages) return messages;
  final sorted = [...messages]..sort((a, b) {
      return ((a['sequenceNumber'] as num?) ?? 0).compareTo((b['sequenceNumber'] as num?) ?? 0);
    });
  return sorted.sublist(sorted.length - maxCachedMessages);
}

String databaseNameFor(String? userId) {
  if (userId == null || userId.isEmpty) return 'company_chat_anon';
  return 'company_chat_${userId.replaceAll(RegExp(r'[^a-zA-Z0-9]'), '')}';
}
