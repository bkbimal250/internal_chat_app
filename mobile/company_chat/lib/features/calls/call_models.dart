enum CallPhase {
  idle,
  initiating,
  ringing,
  connecting,
  connected,
  reconnecting,
  ended,
  missed,
  rejected,
  busy,
  failed,
}

CallPhase callPhaseFromStatus(String? status, {required bool outgoing}) {
  switch (status) {
    case 'initiating':
      return CallPhase.initiating;
    case 'ringing':
      return CallPhase.ringing;
    case 'connecting':
      return CallPhase.connecting;
    case 'connected':
      return CallPhase.connected;
    case 'missed':
      return CallPhase.missed;
    case 'rejected':
      return CallPhase.rejected;
    case 'busy':
      return CallPhase.busy;
    case 'cancelled':
      return outgoing ? CallPhase.ended : CallPhase.missed;
    case 'failed':
      return CallPhase.failed;
    case 'ended':
      return CallPhase.ended;
    default:
      return CallPhase.idle;
  }
}

class CallCapabilities {
  const CallCapabilities({
    this.enabled = false,
    this.turnConfigured = false,
    this.timeoutSeconds = 45,
  });

  final bool enabled;
  final bool turnConfigured;
  final int timeoutSeconds;

  factory CallCapabilities.fromJson(Map<String, dynamic> json) {
    return CallCapabilities(
      enabled: json['enabled'] == true,
      turnConfigured: json['turnConfigured'] == true,
      timeoutSeconds: (json['timeoutSeconds'] as num?)?.toInt() ?? 45,
    );
  }
}

class CallRecord {
  const CallRecord({
    required this.id,
    required this.callerId,
    required this.calleeId,
    required this.status,
    required this.direction,
    required this.createdAt,
    this.peerId,
    this.peerName,
    this.hasPhoto = false,
    this.photoVersion,
  });

  final String id;
  final String callerId;
  final String calleeId;
  final String status;
  final String direction;
  final DateTime? createdAt;
  final String? peerId;
  final String? peerName;
  final bool hasPhoto;
  final String? photoVersion;

  bool get outgoing => direction == 'outgoing';

  factory CallRecord.fromJson(Map<String, dynamic> json) {
    final peer = (json['peer'] as Map?)?.cast<String, dynamic>() ?? {};
    return CallRecord(
      id: json['id'] as String,
      callerId: json['callerId'] as String? ?? '',
      calleeId: json['calleeId'] as String? ?? '',
      status: json['status'] as String? ?? '',
      direction: json['direction'] as String? ?? 'outgoing',
      createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? ''),
      peerId: peer['id'] as String?,
      peerName: (peer['fullName'] as String?)?.trim().isNotEmpty == true
          ? peer['fullName'] as String
          : (peer['displayName'] as String? ?? 'MiChat user'),
      hasPhoto: peer['hasProfilePhoto'] == true,
      photoVersion: peer['photoVersion']?.toString(),
    );
  }
}

class ActiveCall {
  const ActiveCall({
    required this.id,
    required this.peerId,
    required this.peerName,
    required this.outgoing,
    required this.phase,
    this.hasPhoto = false,
    this.photoVersion,
    this.muted = false,
    this.speaker = false,
    this.connectedAt,
    this.error,
  });

  final String id;
  final String peerId;
  final String peerName;
  final bool outgoing;
  final CallPhase phase;
  final bool hasPhoto;
  final String? photoVersion;
  final bool muted;
  final bool speaker;
  final DateTime? connectedAt;
  final String? error;

  bool get isLive =>
      phase == CallPhase.initiating ||
      phase == CallPhase.ringing ||
      phase == CallPhase.connecting ||
      phase == CallPhase.connected ||
      phase == CallPhase.reconnecting;

  bool get incoming => !outgoing && phase == CallPhase.ringing;

  ActiveCall copyWith({
    CallPhase? phase,
    bool? muted,
    bool? speaker,
    DateTime? connectedAt,
    String? error,
    bool clearError = false,
  }) {
    return ActiveCall(
      id: id,
      peerId: peerId,
      peerName: peerName,
      outgoing: outgoing,
      phase: phase ?? this.phase,
      hasPhoto: hasPhoto,
      photoVersion: photoVersion,
      muted: muted ?? this.muted,
      speaker: speaker ?? this.speaker,
      connectedAt: connectedAt ?? this.connectedAt,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

String callStatusLabel(CallPhase phase, {required bool outgoing}) {
  switch (phase) {
    case CallPhase.initiating:
    case CallPhase.ringing:
      return outgoing ? 'Calling…' : 'Incoming voice call';
    case CallPhase.connecting:
      return 'Connecting…';
    case CallPhase.connected:
      return 'Connected';
    case CallPhase.reconnecting:
      return 'Reconnecting…';
    case CallPhase.rejected:
      return 'Declined';
    case CallPhase.busy:
      return 'Busy';
    case CallPhase.missed:
      return outgoing ? 'No answer' : 'Missed call';
    case CallPhase.failed:
      return 'Call failed';
    case CallPhase.ended:
      return 'Call ended';
    case CallPhase.idle:
      return '';
  }
}

