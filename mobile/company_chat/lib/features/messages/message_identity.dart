bool _id(dynamic value) => value is String && value.isNotEmpty;

bool sameLogicalMessage(Map<String, dynamic>? left, Map<String, dynamic>? right) {
  if (left == null || right == null) return false;
  final leftId = left['id'];
  final rightId = right['id'];
  final leftClient = left['clientMessageId'];
  final rightClient = right['clientMessageId'];
  if (_id(leftId) && _id(rightId) && leftId == rightId) return true;
  if (_id(leftClient) && leftClient == rightClient) return true;
  if (_id(leftId) && leftId == rightClient) return true;
  if (_id(rightId) && rightId == leftClient) return true;
  return false;
}

Map<String, dynamic> mergeMessagePayload(Map<String, dynamic> current, Map<String, dynamic> incoming) {
  return {
    ...current,
    ...incoming,
    'id': incoming['id'] ?? current['id'],
    'clientMessageId': incoming['clientMessageId'] ?? current['clientMessageId'],
    'pending': incoming['pending'] ?? false,
  };
}

List<Map<String, dynamic>> collapseDuplicateMessages(Iterable<Map<String, dynamic>> rows) {
  var next = [for (final row in rows) Map<String, dynamic>.from(row)];
  var changed = true;
  while (changed) {
    changed = false;
    final collapsed = <Map<String, dynamic>>[];
    for (final row in next) {
      final index = collapsed.indexWhere((existing) => sameLogicalMessage(existing, row));
      if (index == -1) {
        collapsed.add(row);
      } else {
        collapsed[index] = mergeMessagePayload(collapsed[index], row);
        changed = true;
      }
    }
    next = collapsed;
  }
  return next;
}

List<Map<String, dynamic>> upsertLogicalMessage(
  List<Map<String, dynamic>> current,
  Map<String, dynamic> incoming,
) {
  if (!_id(incoming['id']) && !_id(incoming['clientMessageId'])) return current;
  return collapseDuplicateMessages([...current, incoming]);
}
