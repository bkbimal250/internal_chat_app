int? parseSdpMLineIndex(dynamic value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value.toString());
}

String classifyIceCandidate(String? candidate) {
  final value = candidate ?? '';
  if (value.isEmpty) return 'end';
  if (value.contains('typ relay')) return 'relay';
  if (value.contains('typ srflx')) return 'srflx';
  if (value.contains('typ prflx')) return 'prflx';
  if (value.contains('typ host')) return 'host';
  return 'other';
}

bool isPeerConnectedState(String value) {
  final label = value.toLowerCase();
  if (label.contains('connecting')) return false;
  return label.contains('connected') || label.contains('completed');
}

bool isPeerFailedState(String value) {
  return value.toLowerCase().contains('failed');
}

bool isPeerClosedState(String value) {
  return value.toLowerCase().contains('closed');
}

bool isPeerDisconnectedState(String value) {
  return value.toLowerCase().contains('disconnected');
}
