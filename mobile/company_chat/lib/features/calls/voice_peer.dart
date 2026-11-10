abstract class VoicePeer {
  Stream<Map<String, dynamic>> get iceCandidates;
  Stream<String> get connectionState;

  Future<String> createOffer();
  Future<String> createAnswer();
  Future<void> setRemoteDescription(String type, String sdp);
  Future<void> addIceCandidate(Map<String, dynamic> candidate);
  Future<void> setMuted(bool muted);
  Future<void> setSpeaker(bool speaker);
  Future<void> dispose();
}

typedef VoicePeerFactory = Future<VoicePeer> Function(List<Map<String, dynamic>> iceServers);
