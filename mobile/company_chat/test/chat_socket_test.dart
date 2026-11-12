import 'dart:async';

import 'package:company_chat/core/storage/session_store.dart';
import 'package:company_chat/core/websocket/chat_socket.dart';
import 'package:flutter_test/flutter_test.dart';

class FakeConnection {
  FakeConnection({this.code});

  final controller = StreamController<dynamic>.broadcast();
  final sent = <dynamic>[];
  int? code;

  ChatSocketConnection toConnection() {
    return ChatSocketConnection(
      stream: controller.stream,
      add: sent.add,
      close: ([int? code, String? reason]) async {
        if (!controller.isClosed) await controller.close();
      },
      closeCode: () => code,
    );
  }
}

void main() {
  test('unauthorized websocket closes request a silent refresh', () {
    expect(websocketCloseRequiresReauth(4001), isTrue);
    expect(websocketCloseRequiresReauth(1006), isFalse);
    expect(websocketCloseRequiresReauth(null), isFalse);
  });

  test('connects with the access token and does not open a second socket', () async {
    final store = SessionStore.memory();
    store.applyTokens(access: 'ws-token');
    final opened = <FakeConnection>[];
    final socket = ChatSocket(
      store,
      openChannel: ({required uri, required token}) {
        expect(token, 'ws-token');
        expect(uri.path, '/api/v1/ws');
        final fake = FakeConnection();
        opened.add(fake);
        return fake.toConnection();
      },
    );

    socket.connect();
    socket.connect();
    expect(opened, hasLength(1));
    socket.disconnect();
  });

  test('unauthorized close refreshes and reconnects without dropping the session', () async {
    final store = SessionStore.memory();
    store.applyTokens(access: 'old-token');
    var refreshCalls = 0;
    final opened = <FakeConnection>[];
    final socket = ChatSocket(
      store,
      refreshSession: () async {
        refreshCalls += 1;
        store.applyTokens(access: 'new-token');
      },
      openChannel: ({required uri, required token}) {
        final fake = FakeConnection(code: opened.isEmpty ? 4001 : null);
        opened.add(fake);
        return fake.toConnection();
      },
    );

    socket.connect();
    expect(opened, hasLength(1));
    await opened.first.controller.close();
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(refreshCalls, 1);
    expect(opened, hasLength(2));
    expect(store.accessToken, 'new-token');
    socket.disconnect();
  });

  test('temporary disconnects schedule reconnect without clearing tokens', () async {
    final store = SessionStore.memory();
    store.applyTokens(access: 'ws-token');
    final opened = <FakeConnection>[];
    final socket = ChatSocket(
      store,
      openChannel: ({required uri, required token}) {
        final fake = FakeConnection(code: 1006);
        opened.add(fake);
        return fake.toConnection();
      },
    );

    socket.connect();
    await opened.first.controller.close();
    expect(store.accessToken, 'ws-token');
    expect(opened, hasLength(1));
    socket.disconnect();
  });

  test('signaling sent while disconnected is flushed once on reconnect', () async {
    final store = SessionStore.memory();
    store.applyTokens(access: 'ws-token');
    final opened = <FakeConnection>[];
    final socket = ChatSocket(
      store,
      openChannel: ({required uri, required token}) {
        final fake = FakeConnection();
        opened.add(fake);
        return fake.toConnection();
      },
    );
    socket.connect();
    expect(opened, hasLength(1));
    await opened.first.controller.close();
    socket.send('call.offer', {'callId': 'c1'});
    await Future<void>.delayed(const Duration(milliseconds: 1600));
    expect(opened, hasLength(2));
    expect(
      opened.last.sent.any((row) => row.toString().contains('call.offer')),
      isTrue,
    );
    socket.disconnect();
  });
}
