import 'package:company_chat/features/calls/call_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('maps backend call statuses onto UI phases', () {
    expect(callPhaseFromStatus('ringing', outgoing: true), CallPhase.ringing);
    expect(callPhaseFromStatus('connecting', outgoing: false), CallPhase.connecting);
    expect(callPhaseFromStatus('missed', outgoing: true), CallPhase.missed);
    expect(callPhaseFromStatus('cancelled', outgoing: false), CallPhase.missed);
    expect(callPhaseFromStatus('cancelled', outgoing: true), CallPhase.ended);
  });

  test('live call payloads do not include stored duration or history fields', () {
    final record = CallRecord.fromJson({
      'id': '1',
      'callerId': 'a',
      'calleeId': 'b',
      'status': 'ringing',
      'direction': 'outgoing',
      'createdAt': '2026-01-01T00:00:00.000Z',
      'peer': {'id': 'b', 'displayName': 'Callee'},
    });
    expect(record.outgoing, isTrue);
    expect(record.toString(), isNot(contains('duration')));
    expect(record.toString(), isNot(contains('history')));
  });
}
