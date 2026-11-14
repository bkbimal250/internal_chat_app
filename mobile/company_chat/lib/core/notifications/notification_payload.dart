class NotificationPayload {
  static Map<String, String> decode(String? raw) {
    if (raw == null || raw.isEmpty) return {};
    try {
      final map = <String, String>{};
      for (final part in raw.split('&')) {
        final index = part.indexOf('=');
        if (index <= 0) continue;
        map[Uri.decodeComponent(part.substring(0, index))] = Uri.decodeComponent(part.substring(index + 1));
      }
      return map;
    } catch (_) {
      return {};
    }
  }

  static String encode(Map<String, String> data) {
    return data.entries
        .where((entry) => entry.value.isNotEmpty)
        .map((entry) => '${Uri.encodeComponent(entry.key)}=${Uri.encodeComponent(entry.value)}')
        .join('&');
  }
}
