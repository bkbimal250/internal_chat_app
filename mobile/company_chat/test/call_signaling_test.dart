import 'package:company_chat/features/calls/call_signaling.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('sdpMLineIndex accepts JSON numbers without throwing', () {
    expect(parseSdpMLineIndex(0), 0);
    expect(parseSdpMLineIndex(1.0), 1);
    expect(parseSdpMLineIndex('2'), 2);
    expect(parseSdpMLineIndex(null), isNull);
  });

  test('ICE candidate types are classified without exposing the candidate string', () {
    expect(classifyIceCandidate('candidate:1 1 UDP 1 10.0.0.1 9 typ host'), 'host');
    expect(classifyIceCandidate('candidate:2 1 UDP 1 1.1.1.1 9 typ srflx'), 'srflx');
    expect(classifyIceCandidate('candidate:3 1 UDP 1 2.2.2.2 9 typ relay'), 'relay');
    expect(classifyIceCandidate(''), 'end');
  });

  test('connecting is not treated as connected and closed is distinct from failed', () {
    expect(isPeerConnectedState('RTCIceConnectionStateConnecting'), isFalse);
    expect(isPeerConnectedState('RTCIceConnectionStateConnected'), isTrue);
    expect(isPeerConnectedState('connected'), isTrue);
    expect(isPeerFailedState('RTCIceConnectionStateFailed'), isTrue);
    expect(isPeerClosedState('RTCPeerConnectionStateClosed'), isTrue);
    expect(isPeerDisconnectedState('disconnected'), isTrue);
  });
}
