import 'package:company_chat/features/calls/call_controller.dart';
import 'package:company_chat/features/calls/webrtc_voice_peer.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final callControllerProvider = StateNotifierProvider<CallController, CallState>((ref) {
  return CallController(ref, peerFactory: FlutterVoicePeer.create);
});
