import 'dart:async';

import 'package:company_chat/features/calls/call_signaling.dart';
import 'package:company_chat/features/calls/voice_peer.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

class FlutterVoicePeer implements VoicePeer {
  FlutterVoicePeer._(this._pc, this._local, this._remote);

  final RTCPeerConnection _pc;
  final MediaStream _local;
  final RTCVideoRenderer? _remote;
  final _ice = StreamController<Map<String, dynamic>>.broadcast();
  final _state = StreamController<String>.broadcast();
  bool _disposed = false;

  Widget get remoteView {
    final remote = _remote;
    if (remote == null) return const SizedBox.shrink();
    return RTCVideoView(remote);
  }

  @override
  Stream<Map<String, dynamic>> get iceCandidates => _ice.stream;

  @override
  Stream<String> get connectionState => _state.stream;

  static Future<VoicePeer> create(List<Map<String, dynamic>> iceServers) async {
    await _prepareAudioSession(speaker: false);
    final pc = await createPeerConnection({
      'sdpSemantics': 'unified-plan',
      'iceServers': iceServers,
      'iceCandidatePoolSize': 4,
    });
    final local = await navigator.mediaDevices.getUserMedia({
      'audio': {
        'echoCancellation': true,
        'noiseSuppression': true,
        'autoGainControl': true,
      },
      'video': false,
    });
    RTCVideoRenderer? remote;
    try {
      remote = RTCVideoRenderer();
      await remote.initialize();
    } catch (_) {
      remote = null;
    }
    for (final track in local.getAudioTracks()) {
      await pc.addTrack(track, local);
    }
    final peer = FlutterVoicePeer._(pc, local, remote);
    pc.onIceCandidate = (candidate) {
      if (peer._disposed || candidate.candidate == null || candidate.candidate!.isEmpty) return;
      peer._ice.add({
        'candidate': candidate.candidate,
        'sdpMid': candidate.sdpMid,
        'sdpMLineIndex': parseSdpMLineIndex(candidate.sdpMLineIndex),
      });
    };
    pc.onTrack = (event) {
      if (peer._disposed) return;
      event.track.enabled = true;
      final streams = event.streams;
      final remote = peer._remote;
      if (streams.isNotEmpty && remote != null) {
        remote.srcObject = streams.first;
      }
    };
    pc.onConnectionState = (state) {
      if (peer._disposed) return;
      peer._state.add(state.toString());
    };
    pc.onIceConnectionState = (state) {
      if (peer._disposed) return;
      peer._state.add(state.toString());
    };
    return peer;
  }

  @override
  Future<String> createOffer() async {
    final offer = await _pc.createOffer({
      'offerToReceiveAudio': 1,
      'offerToReceiveVideo': 0,
    });
    await _pc.setLocalDescription(offer);
    return offer.sdp ?? '';
  }

  @override
  Future<String> createAnswer() async {
    final answer = await _pc.createAnswer({
      'offerToReceiveAudio': 1,
      'offerToReceiveVideo': 0,
    });
    await _pc.setLocalDescription(answer);
    return answer.sdp ?? '';
  }

  @override
  Future<void> setRemoteDescription(String type, String sdp) {
    return _pc.setRemoteDescription(RTCSessionDescription(sdp, type));
  }

  @override
  Future<void> addIceCandidate(Map<String, dynamic> candidate) {
    return _pc.addCandidate(
      RTCIceCandidate(
        candidate['candidate'] as String?,
        candidate['sdpMid'] as String?,
        parseSdpMLineIndex(candidate['sdpMLineIndex']),
      ),
    );
  }

  @override
  Future<void> setMuted(bool muted) async {
    for (final track in _local.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  @override
  Future<void> setSpeaker(bool speaker) async {
    try {
      if (speaker) {
        await Helper.setSpeakerphoneOn(true);
      } else {
        await Helper.setSpeakerphoneOnButPreferBluetooth();
      }
    } catch (_) {
      try {
        await Helper.setSpeakerphoneOn(speaker);
      } catch (_) {}
    }
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    try {
      for (final track in _local.getAudioTracks()) {
        await track.stop();
      }
      await _local.dispose();
    } catch (_) {}
    try {
      await _pc.close();
      await _pc.dispose();
    } catch (_) {}
    try {
      _remote?.srcObject = null;
      await _remote?.dispose();
    } catch (_) {}
    await _releaseAudioSession();
    await _ice.close();
    await _state.close();
  }

  static Future<void> _prepareAudioSession({required bool speaker}) async {
    try {
      await WebRTC.initialize(options: {'logSeverity': 'none'});
    } catch (_) {}
    try {
      if (WebRTC.platformIsAndroid) {
        await Helper.setAndroidAudioConfiguration(
          AndroidAudioConfiguration(
            manageAudioFocus: true,
            androidAudioMode: AndroidAudioMode.inCommunication,
            androidAudioFocusMode: AndroidAudioFocusMode.gain,
            androidAudioStreamType: AndroidAudioStreamType.voiceCall,
            androidAudioAttributesUsageType: AndroidAudioAttributesUsageType.voiceCommunication,
            androidAudioAttributesContentType: AndroidAudioAttributesContentType.speech,
            forceHandleAudioRouting: true,
          ),
        );
      } else if (WebRTC.platformIsIOS) {
        await Helper.setAppleAudioIOMode(AppleAudioIOMode.localAndRemote, preferSpeakerOutput: speaker);
      }
    } catch (_) {}
    try {
      if (speaker) {
        await Helper.setSpeakerphoneOn(true);
      } else {
        await Helper.setSpeakerphoneOnButPreferBluetooth();
      }
    } catch (_) {}
  }

  static Future<void> _releaseAudioSession() async {
    try {
      if (WebRTC.platformIsAndroid) {
        await Helper.clearAndroidCommunicationDevice();
      } else if (WebRTC.platformIsIOS) {
        await Helper.setAppleAudioIOMode(AppleAudioIOMode.none);
      }
    } catch (_) {}
  }
}
