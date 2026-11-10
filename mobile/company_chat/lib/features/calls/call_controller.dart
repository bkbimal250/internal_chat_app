import 'dart:async';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/notifications/pending_call.dart';
import 'package:company_chat/features/calls/call_models.dart';
import 'package:company_chat/features/calls/voice_peer.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

class CallState {
  const CallState({
    this.capabilities = const CallCapabilities(),
    this.active,
  });

  final CallCapabilities capabilities;
  final ActiveCall? active;

  CallState copyWith({
    CallCapabilities? capabilities,
    ActiveCall? active,
    bool clearActive = false,
  }) {
    return CallState(
      capabilities: capabilities ?? this.capabilities,
      active: clearActive ? null : (active ?? this.active),
    );
  }
}

class CallController extends StateNotifier<CallState> {
  CallController(this._ref, {required this._peerFactory, this.requestMicrophone})
      : super(const CallState()) {
    _sub = _ref.read(chatSocketProvider).events.listen(_onEvent);
  }

  final Ref _ref;
  final VoicePeerFactory _peerFactory;
  final Future<bool> Function()? requestMicrophone;
  StreamSubscription<Map<String, dynamic>>? _sub;
  VoicePeer? _peer;
  final List<Map<String, dynamic>> _pendingIce = [];
  Map<String, dynamic>? _pendingOffer;
  bool _remoteSet = false;

  Future<void> loadCapabilities() async {
    try {
      final data = await _ref.read(apiClientProvider).get<Map<String, dynamic>>('/api/v1/calls/capabilities');
      if (!mounted) return;
      state = state.copyWith(capabilities: CallCapabilities.fromJson(data));
    } catch (_) {
      if (!mounted) return;
      state = state.copyWith(capabilities: const CallCapabilities());
    }
  }

  Future<void> startCall({
    required String userId,
    required String name,
    bool hasPhoto = false,
    String? photoVersion,
  }) async {
    if (!state.capabilities.enabled) {
      throw ApiError(message: 'Voice calling is not enabled yet.', code: 'CALLS_DISABLED');
    }
    if (state.active?.isLive == true) {
      throw ApiError(message: 'You already have an active call.', code: 'CALL_IN_PROGRESS');
    }
    state = state.copyWith(
      active: ActiveCall(
        id: '',
        peerId: userId,
        peerName: name,
        outgoing: true,
        phase: CallPhase.initiating,
        hasPhoto: hasPhoto,
        photoVersion: photoVersion,
      ),
    );
    try {
      await _ensureMic();
      final created = await _ref.read(apiClientProvider).post<Map<String, dynamic>>(
        '/api/v1/calls',
        data: {'calleeId': userId},
      );
      final record = CallRecord.fromJson(created);
      if (record.direction == 'incoming') {
        state = state.copyWith(
          active: ActiveCall(
            id: record.id,
            peerId: record.peerId ?? userId,
            peerName: record.peerName ?? name,
            outgoing: false,
            phase: CallPhase.ringing,
            hasPhoto: record.hasPhoto,
            photoVersion: record.photoVersion,
          ),
        );
        return;
      }
      state = state.copyWith(
        active: ActiveCall(
          id: record.id,
          peerId: record.peerId ?? userId,
          peerName: record.peerName ?? name,
          outgoing: true,
          phase: CallPhase.ringing,
          hasPhoto: record.hasPhoto,
          photoVersion: record.photoVersion,
        ),
      );
      await _preparePeer(asOfferer: true);
    } catch (error) {
      await _cleanupPeer();
      state = state.copyWith(
        active: state.active?.copyWith(
          phase: error is ApiError && error.code == 'CALL_BUSY' ? CallPhase.busy : CallPhase.failed,
          error: error.toString(),
        ),
      );
      rethrow;
    }
  }

  Future<void> accept(String callId) async {
    final current = state.active;
    if (current == null || current.id != callId) return;
    try {
      await _ensureMic();
      await _ref.read(apiClientProvider).post('/api/v1/calls/$callId/accept');
      state = state.copyWith(active: current.copyWith(phase: CallPhase.connecting));
      await _preparePeer(asOfferer: false);
      pendingCallRoute.clearIf(callId);
    } catch (error) {
      state = state.copyWith(active: current.copyWith(phase: CallPhase.failed, error: error.toString()));
    }
  }

  Future<void> reject(String callId) async {
    try {
      await _ref.read(apiClientProvider).post('/api/v1/calls/$callId/reject');
    } catch (_) {}
    await _finish(CallPhase.rejected, callId: callId);
  }

  Future<void> cancel() async {
    final current = state.active;
    if (current == null || current.id.isEmpty) {
      await _finish(CallPhase.ended);
      return;
    }
    final path = current.outgoing && current.phase != CallPhase.connected
        ? '/api/v1/calls/${current.id}/cancel'
        : '/api/v1/calls/${current.id}/end';
    try {
      await _ref.read(apiClientProvider).post(path);
    } catch (_) {}
    await _finish(CallPhase.ended);
  }

  Future<void> toggleMute() async {
    final current = state.active;
    if (current == null) return;
    final next = !current.muted;
    await _peer?.setMuted(next);
    state = state.copyWith(active: current.copyWith(muted: next));
  }

  Future<void> toggleSpeaker() async {
    final current = state.active;
    if (current == null) return;
    final next = !current.speaker;
    await _peer?.setSpeaker(next);
    state = state.copyWith(active: current.copyWith(speaker: next));
  }

  Future<void> handleIncomingPush(String callId) async {
    if (!state.capabilities.enabled) return;
    if (state.active?.id == callId) return;
    try {
      final data = await _ref.read(apiClientProvider).get<Map<String, dynamic>>('/api/v1/calls/$callId');
      final record = CallRecord.fromJson(data);
      if (record.status != 'ringing' && record.status != 'initiating') return;
      _presentIncoming(record);
    } catch (_) {}
  }

  void dismissTerminal() {
    if (state.active?.isLive == true) return;
    state = state.copyWith(clearActive: true);
  }

  Future<void> _preparePeer({required bool asOfferer}) async {
    final ice = await _ref.read(apiClientProvider).get<Map<String, dynamic>>('/api/v1/calls/ice-config');
    final servers = ((ice['iceServers'] as List?) ?? [])
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
    _peer = await _peerFactory(servers);
    _peer!.iceCandidates.listen((candidate) {
      final id = state.active?.id;
      if (id == null || id.isEmpty) return;
      _ref.read(chatSocketProvider).send('call.ice_candidate', {
        'callId': id,
        'candidate': candidate,
      });
    });
    _peer!.connectionState.listen((value) {
      final current = state.active;
      if (current == null) return;
      final label = value.toLowerCase();
      if (label.contains('connected') || label.contains('completed')) {
        if (current.phase != CallPhase.connected) {
          state = state.copyWith(
            active: current.copyWith(phase: CallPhase.connected, connectedAt: DateTime.now()),
          );
          unawaited(_ref.read(apiClientProvider).post('/api/v1/calls/${current.id}/connected'));
        }
      } else if (label.contains('disconnected') || label.contains('checking')) {
        if (current.phase == CallPhase.connected) {
          state = state.copyWith(active: current.copyWith(phase: CallPhase.reconnecting));
        }
      } else if (label.contains('failed') || label.contains('closed')) {
        if (current.isLive) unawaited(_finish(CallPhase.failed));
      }
    });
    if (asOfferer) {
      final sdp = await _peer!.createOffer();
      _ref.read(chatSocketProvider).send('call.offer', {'callId': state.active?.id, 'sdp': sdp});
    } else if (_pendingOffer != null) {
      await _applyOffer(_pendingOffer!);
    }
    for (final candidate in _pendingIce) {
      await _peer?.addIceCandidate(candidate);
    }
    _pendingIce.clear();
  }

  Future<void> _applyOffer(Map<String, dynamic> data) async {
    final sdp = data['sdp'] as String?;
    if (_peer == null || sdp == null || sdp.isEmpty) return;
    await _peer!.setRemoteDescription('offer', sdp);
    _remoteSet = true;
    final answer = await _peer!.createAnswer();
    _ref.read(chatSocketProvider).send('call.answer', {'callId': state.active?.id, 'sdp': answer});
    _pendingOffer = null;
  }

  void _presentIncoming(CallRecord record) {
    if (state.active?.isLive == true && state.active?.id != record.id) {
      unawaited(_ref.read(apiClientProvider).post('/api/v1/calls/${record.id}/busy'));
      return;
    }
    state = state.copyWith(
      active: ActiveCall(
        id: record.id,
        peerId: record.peerId ?? record.callerId,
        peerName: record.peerName ?? 'MiChat user',
        outgoing: false,
        phase: CallPhase.ringing,
        hasPhoto: record.hasPhoto,
        photoVersion: record.photoVersion,
      ),
    );
    _ref.read(chatSocketProvider).send('call.ringing', {'callId': record.id});
  }

  Future<void> _ensureMic() async {
    final granted = requestMicrophone != null
        ? await requestMicrophone!()
        : (await Permission.microphone.request()).isGranted;
    if (!granted) {
      throw ApiError(message: 'Microphone permission is required for voice calls.', code: 'MIC_DENIED');
    }
  }

  Future<void> _cleanupPeer() async {
    final peer = _peer;
    _peer = null;
    _pendingIce.clear();
    _pendingOffer = null;
    _remoteSet = false;
    await peer?.dispose();
  }

  Future<void> _finish(CallPhase phase, {String? callId}) async {
    await _cleanupPeer();
    final current = state.active;
    if (current == null) return;
    if (callId != null && current.id != callId) return;
    state = state.copyWith(active: current.copyWith(phase: phase));
    pendingCallRoute.clearIf(current.id);
  }

  void _onEvent(Map<String, dynamic> event) {
    final name = event['event'] as String? ?? '';
    final data = (event['data'] as Map?)?.cast<String, dynamic>() ?? {};
    if (name == 'call.invite') {
      if (!state.capabilities.enabled) return;
      _presentIncoming(
        CallRecord(
          id: data['callId'] as String? ?? '',
          callerId: data['callerId'] as String? ?? '',
          calleeId: data['calleeId'] as String? ?? '',
          status: 'ringing',
          direction: 'incoming',
          createdAt: DateTime.tryParse(data['createdAt']?.toString() ?? ''),
          peerId: (data['caller'] as Map?)?['id'] as String?,
          peerName: (data['caller'] as Map?)?['displayName'] as String?,
          hasPhoto: (data['caller'] as Map?)?['hasProfilePhoto'] == true,
          photoVersion: (data['caller'] as Map?)?['photoVersion']?.toString(),
        ),
      );
      return;
    }
    final callId = data['callId'] as String?;
    final current = state.active;
    if (callId == null || current == null || current.id != callId) return;
    if (name == 'call.offer') {
      if (_peer == null) {
        _pendingOffer = data;
      } else {
        unawaited(_applyOffer(data));
      }
      return;
    }
    if (name == 'call.answer') {
      final sdp = data['sdp'] as String?;
      if (_peer != null && sdp != null) {
        unawaited(_peer!.setRemoteDescription('answer', sdp).then((_) => _remoteSet = true));
      }
      return;
    }
    if (name == 'call.ice_candidate') {
      final candidate = (data['candidate'] as Map?)?.cast<String, dynamic>();
      if (candidate == null) return;
      if (_peer == null || !_remoteSet) {
        _pendingIce.add(candidate);
      } else {
        unawaited(_peer!.addIceCandidate(candidate));
      }
      return;
    }
    if (name == 'call.accept') {
      if (!current.outgoing && data['acceptedSessionId'] != null && current.phase == CallPhase.ringing) {
        unawaited(_finish(CallPhase.ended));
      } else if (current.outgoing) {
        state = state.copyWith(active: current.copyWith(phase: CallPhase.connecting));
      }
      return;
    }
    if (name == 'call.reject') {
      unawaited(_finish(CallPhase.rejected));
      return;
    }
    if (name == 'call.cancel' || name == 'call.end') {
      unawaited(_finish(CallPhase.ended));
      return;
    }
    if (name == 'call.busy') {
      unawaited(_finish(CallPhase.busy));
      return;
    }
    if (name == 'call.timeout') {
      unawaited(_finish(CallPhase.missed));
      return;
    }
    if (name == 'call.connected') {
      state = state.copyWith(
        active: current.copyWith(phase: CallPhase.connected, connectedAt: current.connectedAt ?? DateTime.now()),
      );
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    unawaited(_cleanupPeer());
    super.dispose();
  }
}

