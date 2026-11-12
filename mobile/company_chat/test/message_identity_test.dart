import 'package:company_chat/features/messages/message_identity.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('optimistic and server copies of one send collapse to one row', () {
    final optimistic = {
      'id': 'client-1',
      'clientMessageId': 'client-1',
      'content': 'hello brother',
      'pending': true,
    };
    final websocket = {
      'id': 'server-1',
      'content': 'hello brother',
      'sequenceNumber': 4,
    };
    final http = {
      'id': 'server-1',
      'clientMessageId': 'client-1',
      'content': 'hello brother',
      'sequenceNumber': 4,
    };
    final afterSocket = upsertLogicalMessage([optimistic], websocket);
    final afterHttp = upsertLogicalMessage(afterSocket, http);
    expect(afterHttp, hasLength(1));
    expect(afterHttp.single['id'], 'server-1');
    expect(afterHttp.single['clientMessageId'], 'client-1');
    expect(afterHttp.single['pending'], isFalse);
  });

  test('history plus cached plus live copies merge by stable ids not text', () {
    final cached = [
      {'id': 'server-1', 'clientMessageId': 'c1', 'content': 'hello'},
      {'id': 'server-1', 'clientMessageId': 'c1', 'content': 'hello'},
      {'id': 'c2', 'clientMessageId': 'c2', 'content': 'hello', 'pending': true},
    ];
    final history = [
      {'id': 'server-1', 'clientMessageId': 'c1', 'content': 'hello', 'sequenceNumber': 1},
      {'id': 'server-2', 'clientMessageId': 'c2', 'content': 'hello', 'sequenceNumber': 2},
    ];
    var merged = collapseDuplicateMessages(cached);
    for (final row in history) {
      merged = upsertLogicalMessage(merged, row);
    }
    expect(merged, hasLength(2));
    expect(merged.map((row) => row['id']), ['server-1', 'server-2']);
  });

  test('two genuine identical-text messages stay distinct', () {
    final first = {'id': 's1', 'clientMessageId': 'c1', 'content': 'hello', 'sequenceNumber': 1};
    final second = {'id': 's2', 'clientMessageId': 'c2', 'content': 'hello', 'sequenceNumber': 2};
    final merged = upsertLogicalMessage([first], second);
    expect(merged, hasLength(2));
  });

  test('duplicate websocket delivery of the same server id is idempotent', () {
    final row = {'id': 's1', 'clientMessageId': 'c1', 'content': 'maping', 'sequenceNumber': 3};
    final merged = upsertLogicalMessage(upsertLogicalMessage([row], row), {
      'id': 's1',
      'content': 'maping',
      'sequenceNumber': 3,
    });
    expect(merged, hasLength(1));
  });
}
