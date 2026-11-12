import 'dart:async';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:company_chat/core/theme/app_theme.dart';
import 'package:company_chat/core/websocket/chat_socket.dart';
import 'package:company_chat/features/calls/call_controller.dart';
import 'package:company_chat/features/calls/call_models.dart';
import 'package:company_chat/features/calls/call_providers.dart';
import 'package:company_chat/features/calls/call_screens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

final _socket = ChatSocket(
  SessionStore.memory(),
  openChannel: ({required uri, required token}) => ChatSocketConnection(
    stream: const Stream.empty(),
    add: (_) {},
    close: ([code, reason]) async {},
  ),
);

void main() {
  testWidgets('incoming call screen stays inside a compact phone', (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const call = ActiveCall(
      id: 'call-1',
      peerId: 'user-1',
      peerName: 'Priya Sharma',
      outgoing: false,
      phase: CallPhase.ringing,
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          chatSocketProvider.overrideWithValue(_socket),
          callControllerProvider.overrideWith((ref) {
            return CallController(ref, peerFactory: (_) async => throw UnimplementedError(), requestMicrophone: () async => true);
          }),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const IncomingCallScreen(call: call),
        ),
      ),
    );
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text('Incoming voice call'), findsWidgets);
    expect(find.text('Ringing…'), findsNothing);
    expect(find.text('Accept'), findsOneWidget);
    expect(find.text('Decline'), findsOneWidget);
  });

  testWidgets('outgoing call stays Calling until a device acknowledges ringing', (tester) async {
    const call = ActiveCall(
      id: 'call-out',
      peerId: 'user-2',
      peerName: 'Rahul',
      outgoing: true,
      phase: CallPhase.initiating,
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          chatSocketProvider.overrideWithValue(_socket),
          callControllerProvider.overrideWith(
            (ref) => CallController(ref, peerFactory: (_) async => throw UnimplementedError()),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const ActiveCallScreen(call: call),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Calling…'), findsOneWidget);
    expect(find.text('Ringing…'), findsNothing);
  });

  testWidgets('connected call screen shows mute speaker and end', (tester) async {
    const call = ActiveCall(
      id: 'call-2',
      peerId: 'user-2',
      peerName: 'Rahul',
      outgoing: true,
      phase: CallPhase.connected,
      connectedAt: null,
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          chatSocketProvider.overrideWithValue(_socket),
          callControllerProvider.overrideWith(
            (ref) => CallController(ref, peerFactory: (_) async => throw UnimplementedError()),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const ActiveCallScreen(call: call),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Mute'), findsOneWidget);
    expect(find.text('Speaker'), findsOneWidget);
    expect(find.text('End'), findsOneWidget);
    expect(find.text('Record'), findsNothing);
    expect(find.text('History'), findsNothing);
    expect(find.byIcon(Icons.videocam), findsNothing);
  });
}
