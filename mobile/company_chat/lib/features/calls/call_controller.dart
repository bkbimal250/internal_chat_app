import 'dart:async';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/notifications/pending_call.dart';
import 'package:company_chat/features/calls/call_models.dart';
import 'package:company_chat/features/calls/call_signaling.dart';
import 'package:company_chat/features/calls/voice_peer.dart';
import 'package:company_chat/features/calls/webrtc_voice_peer.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
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
  final List<Map<String, dynamic>> _pendingRemoteIce = [];
  final List<Map<String, dynamic>> _pendingLocalIce = [];
  Map<String, dynamic>? _pendingOffer;
  String? _localOffer;
  bool _remoteSet = false;
  bool _offerSent = false;
  bool _signalingOpen = false;
  int _generation = 0;
  int _iceHost = 0;
  int _iceSrflx = 0;
  int _iceRelay = 0;
  int _iceOther = 0;

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
    final generation = ++_generation;
    _resetSignaling();
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
      if (!_isCurrent(generation)) return;
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
          phase: CallPhase.initiating,
          hasPhoto: record.hasPhoto,
          photoVersion: record.photoVersion,
        ),
      );
      _trace('outgoing start', {'callId': record.id, 'phase': 'calling'});
      await _preparePeer(asOfferer: true, generation: generation);
    } catch (error) {
      if (!_isCurrent(generation)) return;
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
    if (current == null || current.id != callId || current.outgoing) return;
    if (current.phase != CallPhase.ringing && current.phase != CallPhase.connecting) return;
    final generation = _generation;
    _signalingOpen = true;
    state = state.copyWith(active: current.copyWith(phase: CallPhase.connecting, clearError: true));
    _trace('accept local', {'callId': callId});
    try {
      await _ensureMic();
      if (!_isCurrent(generation, callId)) return;
      await _ref.read(apiClientProvider).post('/api/v1/calls/$callId/accept');
      if (!_isCurrent(generation, callId)) return;
      _trace('accept acknowledged', {'callId': callId});
      await _preparePeer(asOfferer: false, generation: generation);
      pendingCallRoute.clearIf(callId);
    } catch (error) {
      if (!_isCurrent(generation, callId)) return;
      if (error is ApiError && error.code == 'CALL_OWNED_BY_OTHER_DEVICE') {
        await _finish(CallPhase.ended, callId: callId, reason: 'answered-elsewhere');
        return;
      }
      if (error is ApiError && error.code == 'MIC_DENIED') {
        try {
          await _ref.read(apiClientProvider).post('/api/v1/calls/$callId/end');
        } catch (_) {}
      }
      state = state.copyWith(
        active: state.active?.copyWith(phase: CallPhase.failed, error: error.toString()),
      );
    }
  }

  Future<void> reject(String callId) async {
    try {
      await _ref.read(apiClientProvider).post('/api/v1/calls/$callId/reject');
    } catch (_) {}
    await _finish(CallPhase.rejected, callId: callId, reason: 'reject');
  }

  Future<void> cancel() async {
    final current = state.active;
    if (current == null || current.id.isEmpty) {
      await _finish(CallPhase.ended, reason: 'local-cancel');
      return;
    }
    final path = current.outgoing && current.phase != CallPhase.connected
        ? '/api/v1/calls/${current.id}/cancel'
        : '/api/v1/calls/${current.id}/end';
    try {
      await _ref.read(apiClientProvider).post(path);
    } catch (_) {}
    await _finish(CallPhase.ended, reason: 'local-hangup');
  }

  Future<void> toggleMute() async {
    final current = state.active;
    if (current == null) return;
    final next = !current.muted;
    await _peer?.setMuted(next);
    state = state.copyWith(active: current.copyWith(muted: next));
  }

  Widget remoteMediaView() {
    final peer = _peer;
    if (peer is FlutterVoicePeer) return peer.remoteView;
    return const SizedBox.shrink();
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

  Future<void> _preparePeer({required bool asOfferer, required int generation}) async {
    final ice = await _ref.read(apiClientProvider).get<Map<String, dynamic>>('/api/v1/calls/ice-config');
    if (!_isCurrent(generation)) return;
    final servers = ((ice['iceServers'] as List?) ?? [])
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
    _trace('ice-config', {
      'callId': state.active?.id,
      'stun': servers.where((row) => _urlsOf(row).any((url) => url.startsWith('stun:'))).length,
      'turn': servers.where((row) => _urlsOf(row).any((url) => url.startsWith('turn:'))).length,
    });
    final peer = await _peerFactory(servers);
    if (!_isCurrent(generation)) {
      await peer.dispose();
      return;
    }
    _peer = peer;
    peer.iceCandidates.listen((candidate) {
      if (!identical(_peer, peer)) return;
      _countIce(candidate['candidate'] as String?);
      if (_signalingOpen && state.active?.id.isNotEmpty == true) {
        _sendSignal('call.ice_candidate', {
          'callId': state.active!.id,
          'candidate': candidate,
        });
      } else {
        _pendingLocalIce.add(candidate);
      }
    });
    peer.connectionState.listen((value) {
      if (!identical(_peer, peer) || !mounted) return;
      _onPeerState(value);
    });
    if (asOfferer) {
      _localOffer = await peer.createOffer();
      _trace('offer created', {'callId': state.active?.id, 'sdpBytes': _localOffer?.length});
    } else if (_pendingOffer != null) {
      await _applyOffer(_pendingOffer!);
    }
    if (_remoteSet) await _flushRemoteIce();
  }

  Future<void> _applyOffer(Map<String, dynamic> data) async {
    final sdp = data['sdp'] as String?;
    if (_peer == null || sdp == null || sdp.isEmpty) return;
    if (_remoteSet) {
      _trace('duplicate offer ignored', {'callId': state.active?.id});
      return;
    }
    await _peer!.setRemoteDescription('offer', sdp);
    _remoteSet = true;
    _trace('offer received', {'callId': state.active?.id, 'sdpBytes': sdp.length});
    final answer = await _peer!.createAnswer();
    _sendSignal('call.answer', {'callId': state.active?.id, 'sdp': answer});
    _signalingOpen = true;
    _trace('answer sent', {'callId': state.active?.id, 'sdpBytes': answer.length});
    _pendingOffer = null;
    _flushLocalIce();
    await _flushRemoteIce();
  }

  void _presentIncoming(CallRecord record) {
    if (state.active?.isLive == true && state.active?.id != record.id) {
      unawaited(_ref.read(apiClientProvider).post('/api/v1/calls/${record.id}/busy'));
      return;
    }
    if (state.active?.id == record.id) return;
    _generation++;
    _resetSignaling();
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
    _trace('incoming', {'callId': record.id});
    _sendSignal('call.ringing', {'callId': record.id});
  }

  Future<void> _ensureMic() async {
    final granted = requestMicrophone != null
        ? await requestMicrophone!()
        : (await Permission.microphone.request()).isGranted;
    if (!granted) {
      throw ApiError(message: 'Microphone permission is required for voice calls.', code: 'MIC_DENIED');
    }
  }

  void _onPeerState(String value) {
    final current = state.active;
    if (current == null || !current.isLive) return;
    _trace('peer-state', {'callId': current.id, 'state': value});
    if (isPeerConnectedState(value)) {
      if (current.phase != CallPhase.connected) {
        state = state.copyWith(
          active: current.copyWith(phase: CallPhase.connected, connectedAt: DateTime.now()),
        );
        _trace('connected', {
          'callId': current.id,
          'host': _iceHost,
          'srflx': _iceSrflx,
          'relay': _iceRelay,
          'other': _iceOther,
        });
        unawaited(_ref.read(apiClientProvider).post('/api/v1/calls/${current.id}/connected'));
      }
      return;
    }
    if (isPeerDisconnectedState(value) && current.phase == CallPhase.connected) {
      state = state.copyWith(active: current.copyWith(phase: CallPhase.reconnecting));
      return;
    }
    if (isPeerFailedState(value) && current.isLive) {
      _trace('ice failed kept live', {'callId': current.id, 'phase': current.phase.name});
      if (current.phase == CallPhase.connected || current.phase == CallPhase.connecting) {
        state = state.copyWith(active: current.copyWith(phase: CallPhase.reconnecting));
      }
    }
  }

  Future<void> _cleanupPeer() async {
    final peer = _peer;
    _peer = null;
    _resetSignaling();
    await peer?.dispose();
  }

  void _resetSignaling() {
    _pendingRemoteIce.clear();
    _pendingLocalIce.clear();
    _pendingOffer = null;
    _localOffer = null;
    _remoteSet = false;
    _offerSent = false;
    _signalingOpen = false;
    _iceHost = 0;
    _iceSrflx = 0;
    _iceRelay = 0;
    _iceOther = 0;
  }

  Future<void> _finish(CallPhase phase, {String? callId, String? reason}) async {
    final current = state.active;
    if (current == null) return;
    if (callId != null && current.id != callId) {
      _trace('stale hangup ignored', {'eventCallId': callId, 'activeCallId': current.id, 'reason': reason});
      return;
    }
    _trace('finish', {'callId': current.id, 'phase': phase.name, 'reason': reason});
    _generation++;
    await _cleanupPeer();
    if (!mounted) return;
    if (state.active?.id != current.id) return;
    state = state.copyWith(active: current.copyWith(phase: phase));
    pendingCallRoute.clearIf(current.id);
  }

  void _sendSignal(String event, Map<String, dynamic> data) {
    _ref.read(chatSocketProvider).send(event, data);
  }

  void _flushLocalOffer() {
    final id = state.active?.id;
    if (!_signalingOpen || id == null || id.isEmpty || _localOffer == null || _offerSent) return;
    _sendSignal('call.offer', {'callId': id, 'sdp': _localOffer});
    _offerSent = true;
    _trace('offer sent', {'callId': id, 'sdpBytes': _localOffer!.length});
    _flushLocalIce();
  }

  void _flushLocalIce() {
    final id = state.active?.id;
    if (!_signalingOpen || id == null || id.isEmpty) return;
    for (final candidate in _pendingLocalIce) {
      _sendSignal('call.ice_candidate', {'callId': id, 'candidate': candidate});
    }
    if (_pendingLocalIce.isNotEmpty) {
      _trace('local ice flushed', {'callId': id, 'count': _pendingLocalIce.length});
    }
    _pendingLocalIce.clear();
  }

  Future<void> _flushRemoteIce() async {
    if (_peer == null || !_remoteSet) return;
    final queued = [..._pendingRemoteIce];
    _pendingRemoteIce.clear();
    for (final candidate in queued) {
      await _peer?.addIceCandidate(candidate);
    }
    if (queued.isNotEmpty) {
      _trace('remote ice flushed', {'callId': state.active?.id, 'count': queued.length});
    }
  }

  void _countIce(String? candidate) {
    switch (classifyIceCandidate(candidate)) {
      case 'host':
        _iceHost += 1;
      case 'srflx':
        _iceSrflx += 1;
      case 'relay':
        _iceRelay += 1;
      default:
        _iceOther += 1;
    }
  }

  bool _isCurrent(int generation, [String? callId]) {
    if (!mounted || generation != _generation) return false;
    if (callId != null && state.active?.id != callId) return false;
    return true;
  }

  List<String> _urlsOf(Map<String, dynamic> server) {
    final urls = server['urls'];
    if (urls is String) return [urls];
    if (urls is List) return urls.map((item) => item.toString()).toList();
    return const [];
  }

  void _trace(String message, [Map<String, Object?> extra = const {}]) {
    if (!kDebugMode) return;
    final parts = extra.entries.map((entry) => '${entry.key}=${entry.value}').join(' ');
    debugPrint('[call] $message${parts.isEmpty ? '' : ' $parts'}');
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
    if (callId == null || current == null || current.id != callId) {
      if (callId != null && current != null && current.id != callId && name.startsWith('call.')) {
        _trace('stale event ignored', {'event': name, 'eventCallId': callId, 'activeCallId': current.id});
      }
      return;
    }
    if (name == 'call.offer') {
      if (_peer == null) {
        _pendingOffer = data;
        _trace('offer queued', {'callId': callId});
      } else {
        unawaited(_applyOffer(data));
      }
      return;
    }
    if (name == 'call.answer') {
      final sdp = data['sdp'] as String?;
      if (_peer != null && sdp != null && !_remoteSet) {
        unawaited(() async {
          await _peer!.setRemoteDescription('answer', sdp);
          _remoteSet = true;
          _trace('answer received', {'callId': callId, 'sdpBytes': sdp.length});
          await _flushRemoteIce();
        }());
      } else if (_remoteSet) {
        _trace('duplicate answer ignored', {'callId': callId});
      }
      return;
    }
    if (name == 'call.ice_candidate') {
      final candidate = (data['candidate'] as Map?)?.cast<String, dynamic>();
      if (candidate == null) return;
      if (_peer == null || !_remoteSet) {
        _pendingRemoteIce.add(candidate);
      } else {
        unawaited(_peer!.addIceCandidate(candidate));
      }
      return;
    }
    if (name == 'call.ringing') {
      if (current.outgoing && (current.phase == CallPhase.initiating || current.phase == CallPhase.ringing)) {
        state = state.copyWith(active: current.copyWith(phase: CallPhase.ringing));
        _trace('callee ringing ack', {'callId': callId});
      }
      return;
    }
    if (name == 'call.accept') {
      if (!current.outgoing) {
        if (current.phase == CallPhase.ringing) {
          unawaited(_finish(CallPhase.ended, callId: callId, reason: 'answered-elsewhere'));
        } else {
          _trace('own accept echo ignored', {'callId': callId, 'phase': current.phase.name});
        }
        return;
      }
      _signalingOpen = true;
      state = state.copyWith(active: current.copyWith(phase: CallPhase.connecting));
      _flushLocalOffer();
      return;
    }
    if (name == 'call.reject') {
      unawaited(_finish(CallPhase.rejected, reason: 'remote-reject'));
      return;
    }
    if (name == 'call.cancel') {
      unawaited(_finish(CallPhase.ended, reason: 'remote-cancel'));
      return;
    }
    if (name == 'call.end') {
      final neverConnected = current.connectedAt == null && current.phase != CallPhase.connected;
      unawaited(_finish(neverConnected ? CallPhase.failed : CallPhase.ended, reason: neverConnected ? 'connect-timeout' : 'remote-end'));
      return;
    }
    if (name == 'call.busy') {
      unawaited(_finish(CallPhase.busy, reason: 'busy'));
      return;
    }
    if (name == 'call.timeout') {
      unawaited(_finish(CallPhase.missed, reason: 'timeout'));
      return;
    }
    if (name == 'call.connected') {
      if (current.phase == CallPhase.connected) return;
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
