import 'dart:async';
import 'dart:convert';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:company_chat/core/websocket/chat_socket.dart';
import 'package:company_chat/features/calls/call_controller.dart';
import 'package:company_chat/features/calls/call_models.dart';
import 'package:company_chat/features/calls/voice_peer.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class FakePeer implements VoicePeer {
  final ice = StreamController<Map<String, dynamic>>.broadcast();
  final states = StreamController<String>.broadcast();
  var disposed = false;
  var muted = false;
  var speaker = false;
  String? remoteType;

  @override
  Stream<Map<String, dynamic>> get iceCandidates => ice.stream;

  @override
  Stream<String> get connectionState => states.stream;

  @override
  Future<String> createOffer() async => 'offer-sdp';

  @override
  Future<String> createAnswer() async => 'answer-sdp';

  @override
  Future<void> setRemoteDescription(String type, String sdp) async {
    remoteType = type;
  }

  @override
  Future<void> addIceCandidate(Map<String, dynamic> candidate) async {}

  @override
  Future<void> setMuted(bool value) async => muted = value;

  @override
  Future<void> setSpeaker(bool value) async => speaker = value;

  @override
  Future<void> dispose() async {
    disposed = true;
    await ice.close();
    await states.close();
  }
}

Dio _dio(Map<String, dynamic> Function(RequestOptions) handler) {
  final dio = Dio(BaseOptions(baseUrl: 'http://calls.test'));
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, sink) {
        sink.resolve(
          Response(requestOptions: options, data: handler(options), statusCode: 200),
        );
      },
    ),
  );
  return dio;
}

void main() {
  test('outgoing call creates a peer offer and mute/speaker toggle the fake peer', () async {
    final peer = FakePeer();
    final sent = <dynamic>[];
    final dio = _dio((options) {
      if (options.path.endsWith('/capabilities')) {
        return {'enabled': true, 'turnConfigured': false, 'timeoutSeconds': 45};
      }
      if (options.path.endsWith('/ice-config')) {
        return {
          'iceServers': [
            {'urls': ['stun:stun.test:3478']},
          ],
        };
      }
      if (options.method == 'POST' && options.path.endsWith('/calls')) {
        return {
          'id': '11111111-1111-4111-8111-111111111111',
          'callerId': 'caller',
          'calleeId': 'callee',
          'status': 'ringing',
          'direction': 'outgoing',
          'createdAt': DateTime.now().toIso8601String(),
          'peer': {'id': 'callee', 'displayName': 'Callee'},
        };
      }
      if (options.path.contains('/connected')) return {'status': 'connected'};
      return {};
    });
    late CallController controller;
    final provider = StateNotifierProvider<CallController, CallState>((ref) {
      controller = CallController(
        ref,
        peerFactory: (_) async => peer,
        requestMicrophone: () async => true,
      );
      return controller;
    });
    final container = ProviderContainer(
      overrides: [
        sessionStoreProvider.overrideWithValue(SessionStore.memory()),
        apiClientProvider.overrideWithValue(ApiClient(SessionStore.memory(), client: dio)),
        chatSocketProvider.overrideWithValue(
          ChatSocket(
            SessionStore.memory(),
            openChannel: ({required uri, required token}) => ChatSocketConnection(
              stream: const Stream.empty(),
              add: sent.add,
              close: ([code, reason]) async {},
            ),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    container.read(provider);
    await controller.loadCapabilities();
    expect(controller.state.capabilities.enabled, isTrue);
    await controller.startCall(userId: 'callee', name: 'Callee');
    expect(controller.state.active?.phase, CallPhase.initiating);
    expect(controller.state.active?.outgoing, isTrue);
    await controller.toggleMute();
    await controller.toggleSpeaker();
    expect(peer.muted, isTrue);
    expect(peer.speaker, isTrue);
    peer.states.add('connected');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(controller.state.active?.phase, CallPhase.connected);
    await controller.cancel();
    expect(peer.disposed, isTrue);
    expect(controller.state.active?.phase, CallPhase.ended);
  });

  test('permission denied does not leave a live call', () async {
    final dio = _dio((options) => {'enabled': true, 'turnConfigured': false});
    late CallController controller;
    final provider = StateNotifierProvider<CallController, CallState>((ref) {
      controller = CallController(
        ref,
        peerFactory: (_) async => FakePeer(),
        requestMicrophone: () async => false,
      );
      return controller;
    });
    final container = ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(ApiClient(SessionStore.memory(), client: dio)),
        chatSocketProvider.overrideWithValue(
          ChatSocket(
            SessionStore.memory(),
            openChannel: ({required uri, required token}) => ChatSocketConnection(
              stream: const Stream.empty(),
              add: (_) {},
              close: ([code, reason]) async {},
            ),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    container.read(provider);
    await controller.loadCapabilities();
    await expectLater(
      controller.startCall(userId: 'callee', name: 'Callee'),
      throwsA(isA<ApiError>().having((error) => error.code, 'code', 'MIC_DENIED')),
    );
    expect(controller.state.active?.phase, CallPhase.failed);
  });

  test('startCall is blocked when calling is disabled', () async {
    final dio = _dio((options) => {'enabled': false, 'recorded': false, 'persisted': false});
    late CallController controller;
    final provider = StateNotifierProvider<CallController, CallState>((ref) {
      controller = CallController(ref, peerFactory: (_) async => FakePeer());
      return controller;
    });
    final container = ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(ApiClient(SessionStore.memory(), client: dio)),
        chatSocketProvider.overrideWithValue(
          ChatSocket(
            SessionStore.memory(),
            openChannel: ({required uri, required token}) => ChatSocketConnection(
              stream: const Stream.empty(),
              add: (_) {},
              close: ([code, reason]) async {},
            ),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    container.read(provider);
    await controller.loadCapabilities();
    expect(controller.state.capabilities.enabled, isFalse);
    await expectLater(
      controller.startCall(userId: 'callee', name: 'Callee'),
      throwsA(isA<ApiError>().having((error) => error.code, 'code', 'CALLS_DISABLED')),
    );
    expect(controller.state.active, isNull);
  });

  test('caller waits for accept before sending the offer and connects on ICE', () async {
    final peer = FakePeer();
    final sent = <dynamic>[];
    final incoming = StreamController<dynamic>.broadcast();
    addTearDown(incoming.close);
    final dio = _dio((options) {
      if (options.path.endsWith('/capabilities')) {
        return {'enabled': true, 'turnConfigured': true, 'timeoutSeconds': 45};
      }
      if (options.path.endsWith('/ice-config')) {
        return {
          'iceServers': [
            {'urls': ['stun:stun.test:3478']},
            {'urls': ['turn:turn.test:3478'], 'username': 'ttl:user', 'credential': 'temp'},
          ],
        };
      }
      if (options.method == 'POST' && options.path.endsWith('/calls')) {
        return {
          'id': '11111111-1111-4111-8111-111111111111',
          'callerId': 'caller',
          'calleeId': 'callee',
          'status': 'ringing',
          'direction': 'outgoing',
          'createdAt': DateTime.now().toIso8601String(),
          'peer': {'id': 'callee', 'displayName': 'Callee', 'hasProfilePhoto': true},
        };
      }
      if (options.path.contains('/connected')) return {'status': 'connected'};
      if (options.path.contains('/end')) return {'status': 'ended'};
      return {};
    });
    late CallController controller;
    final store = SessionStore.memory()..applyTokens(access: 'token');
    final socket = ChatSocket(
      store,
      openChannel: ({required uri, required token}) => ChatSocketConnection(
        stream: incoming.stream,
        add: sent.add,
        close: ([code, reason]) async {},
      ),
    );
    final provider = StateNotifierProvider<CallController, CallState>((ref) {
      controller = CallController(
        ref,
        peerFactory: (_) async => peer,
        requestMicrophone: () async => true,
      );
      return controller;
    });
    final container = ProviderContainer(
      overrides: [
        sessionStoreProvider.overrideWithValue(store),
        apiClientProvider.overrideWithValue(ApiClient(store, client: dio)),
        chatSocketProvider.overrideWithValue(socket),
      ],
    );
    addTearDown(container.dispose);
    container.read(provider);
    socket.connect();
    await controller.loadCapabilities();
    await controller.startCall(userId: 'callee', name: 'Callee');
    expect(controller.state.active?.phase, CallPhase.initiating);
    expect(
      sent.where((row) => jsonDecode(row as String)['event'] == 'call.offer'),
      isEmpty,
    );
    incoming.add(jsonEncode({
      'event': 'call.ringing',
      'data': {'callId': '11111111-1111-4111-8111-111111111111'},
    }));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(controller.state.active?.phase, CallPhase.ringing);
    incoming.add(jsonEncode({
      'event': 'call.accept',
      'data': {'callId': '11111111-1111-4111-8111-111111111111'},
    }));
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(controller.state.active?.phase, CallPhase.connecting);
    expect(
      sent.where((row) => jsonDecode(row as String)['event'] == 'call.offer'),
      isNotEmpty,
    );
    incoming.add(jsonEncode({
      'event': 'call.answer',
      'data': {'callId': '11111111-1111-4111-8111-111111111111', 'sdp': 'answer-sdp'},
    }));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(peer.remoteType, 'answer');
    peer.states.add('RTCIceConnectionStateConnected');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(controller.state.active?.phase, CallPhase.connected);
    expect(controller.state.active?.connectedAt, isNotNull);
  });

  test('stale hangup and duplicate signaling do not kill a newer call', () async {
    final peer = FakePeer();
    final incoming = StreamController<dynamic>.broadcast();
    addTearDown(incoming.close);
    final dio = _dio((options) {
      if (options.path.endsWith('/capabilities')) return {'enabled': true};
      if (options.path.endsWith('/ice-config')) {
        return {'iceServers': [{'urls': ['stun:stun.test:3478']}]};
      }
      if (options.method == 'POST' && options.path.endsWith('/calls')) {
        return {
          'id': '22222222-2222-4222-8222-222222222222',
          'callerId': 'caller',
          'calleeId': 'callee',
          'status': 'ringing',
          'direction': 'outgoing',
          'createdAt': DateTime.now().toIso8601String(),
          'peer': {'id': 'callee', 'displayName': 'Callee'},
        };
      }
      if (options.path.contains('/end')) return {'status': 'ended'};
      return {};
    });
    late CallController controller;
    final store = SessionStore.memory()..applyTokens(access: 'token');
    final socket = ChatSocket(
      store,
      openChannel: ({required uri, required token}) => ChatSocketConnection(
        stream: incoming.stream,
        add: (_) {},
        close: ([code, reason]) async {},
      ),
    );
    final provider = StateNotifierProvider<CallController, CallState>((ref) {
      controller = CallController(
        ref,
        peerFactory: (_) async => peer,
        requestMicrophone: () async => true,
      );
      return controller;
    });
    final container = ProviderContainer(
      overrides: [
        sessionStoreProvider.overrideWithValue(store),
        apiClientProvider.overrideWithValue(ApiClient(store, client: dio)),
        chatSocketProvider.overrideWithValue(socket),
      ],
    );
    addTearDown(container.dispose);
    container.read(provider);
    socket.connect();
    await controller.loadCapabilities();
    await controller.startCall(userId: 'callee', name: 'Callee');
    incoming.add(jsonEncode({
      'event': 'call.end',
      'data': {'callId': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    }));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(controller.state.active?.phase, CallPhase.initiating);
    incoming.add(jsonEncode({
      'event': 'call.end',
      'data': {'callId': '22222222-2222-4222-8222-222222222222'},
    }));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(controller.state.active?.phase, CallPhase.failed);
  });

  test('receiver accept answers a queued offer and hangup ends the call', () async {
    final peer = FakePeer();
    final sent = <dynamic>[];
    final incoming = StreamController<dynamic>.broadcast();
    addTearDown(incoming.close);
    final dio = _dio((options) {
      if (options.path.endsWith('/capabilities')) return {'enabled': true};
      if (options.path.endsWith('/ice-config')) {
        return {'iceServers': [{'urls': ['stun:stun.test:3478']}]};
      }
      if (options.path.contains('/accept')) return {'status': 'connecting'};
      if (options.path.contains('/end')) return {'status': 'ended'};
      return {};
    });
    late CallController controller;
    final store = SessionStore.memory()..applyTokens(access: 'token');
    final socket = ChatSocket(
      store,
      openChannel: ({required uri, required token}) => ChatSocketConnection(
        stream: incoming.stream,
        add: sent.add,
        close: ([code, reason]) async {},
      ),
    );
    final provider = StateNotifierProvider<CallController, CallState>((ref) {
      controller = CallController(
        ref,
        peerFactory: (_) async => peer,
        requestMicrophone: () async => true,
      );
      return controller;
    });
    final container = ProviderContainer(
      overrides: [
        sessionStoreProvider.overrideWithValue(store),
        apiClientProvider.overrideWithValue(ApiClient(store, client: dio)),
        chatSocketProvider.overrideWithValue(socket),
      ],
    );
    addTearDown(container.dispose);
    container.read(provider);
    socket.connect();
    await controller.loadCapabilities();
    incoming.add(jsonEncode({
      'event': 'call.invite',
      'data': {
        'callId': '33333333-3333-4333-8333-333333333333',
        'callerId': 'caller',
        'calleeId': 'me',
        'createdAt': DateTime.now().toIso8601String(),
        'caller': {'id': 'caller', 'displayName': 'Caller', 'hasProfilePhoto': true},
      },
    }));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    incoming.add(jsonEncode({
      'event': 'call.offer',
      'data': {'callId': '33333333-3333-4333-8333-333333333333', 'sdp': 'offer-sdp'},
    }));
    await Future<void>.delayed(const Duration(milliseconds: 10));
    await controller.accept('33333333-3333-4333-8333-333333333333');
    expect(controller.state.active?.phase, CallPhase.connecting);
    expect(peer.remoteType, 'offer');
    expect(
      sent.where((row) => jsonDecode(row as String)['event'] == 'call.answer'),
      isNotEmpty,
    );
    incoming.add(jsonEncode({
      'event': 'call.offer',
      'data': {'callId': '33333333-3333-4333-8333-333333333333', 'sdp': 'offer-sdp'},
    }));
    await controller.cancel();
    expect(peer.disposed, isTrue);
    expect(controller.state.active?.phase, CallPhase.ended);
  });

  test('failed ICE keeps a connecting call live as Reconnecting', () async {
    final peer = FakePeer();
    final incoming = StreamController<dynamic>.broadcast();
    addTearDown(incoming.close);
    final dio = _dio((options) {
      if (options.path.endsWith('/capabilities')) return {'enabled': true};
      if (options.path.endsWith('/ice-config')) {
        return {'iceServers': [{'urls': ['stun:stun.test:3478']}]};
      }
      if (options.method == 'POST' && options.path.endsWith('/calls')) {
        return {
          'id': '44444444-4444-4444-8444-444444444444',
          'callerId': 'caller',
          'calleeId': 'callee',
          'status': 'ringing',
          'direction': 'outgoing',
          'createdAt': DateTime.now().toIso8601String(),
          'peer': {'id': 'callee', 'displayName': 'Callee'},
        };
      }
      if (options.path.contains('/end')) return {'status': 'ended'};
      return {};
    });
    late CallController controller;
    final store = SessionStore.memory()..applyTokens(access: 'token');
    final socket = ChatSocket(
      store,
      openChannel: ({required uri, required token}) => ChatSocketConnection(
        stream: incoming.stream,
        add: (_) {},
        close: ([code, reason]) async {},
      ),
    );
    final provider = StateNotifierProvider<CallController, CallState>((ref) {
      controller = CallController(
        ref,
        peerFactory: (_) async => peer,
        requestMicrophone: () async => true,
      );
      return controller;
    });
    final container = ProviderContainer(
      overrides: [
        sessionStoreProvider.overrideWithValue(store),
        apiClientProvider.overrideWithValue(ApiClient(store, client: dio)),
        chatSocketProvider.overrideWithValue(socket),
      ],
    );
    addTearDown(container.dispose);
    container.read(provider);
    socket.connect();
    await controller.loadCapabilities();
    await controller.startCall(userId: 'callee', name: 'Callee');
    incoming.add(jsonEncode({
      'event': 'call.accept',
      'data': {'callId': '44444444-4444-4444-8444-444444444444'},
    }));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(controller.state.active?.phase, CallPhase.connecting);
    peer.states.add('RTCIceConnectionStateFailed');
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(controller.state.active?.phase, CallPhase.reconnecting);
    expect(controller.state.active?.isLive, isTrue);
    expect(controller.state.active?.phase, isNot(CallPhase.ended));
    expect(controller.state.active?.phase, isNot(CallPhase.failed));
  });

  test('accept echo does not end the local incoming call', () async {
    final peer = FakePeer();
    final incoming = StreamController<dynamic>.broadcast();
    addTearDown(incoming.close);
    final dio = _dio((options) {
      if (options.path.endsWith('/capabilities')) return {'enabled': true};
      if (options.path.endsWith('/ice-config')) {
        return {'iceServers': [{'urls': ['stun:stun.test:3478']}]};
      }
      if (options.path.contains('/accept')) return {'status': 'connecting'};
      return {};
    });
    late CallController controller;
    final store = SessionStore.memory()..applyTokens(access: 'token');
    final socket = ChatSocket(
      store,
      openChannel: ({required uri, required token}) => ChatSocketConnection(
        stream: incoming.stream,
        add: (_) {},
        close: ([code, reason]) async {},
      ),
    );
    final provider = StateNotifierProvider<CallController, CallState>((ref) {
      controller = CallController(
        ref,
        peerFactory: (_) async => peer,
        requestMicrophone: () async => true,
      );
      return controller;
    });
    final container = ProviderContainer(
      overrides: [
        sessionStoreProvider.overrideWithValue(store),
        apiClientProvider.overrideWithValue(ApiClient(store, client: dio)),
        chatSocketProvider.overrideWithValue(socket),
      ],
    );
    addTearDown(container.dispose);
    container.read(provider);
    socket.connect();
    await controller.loadCapabilities();
    incoming.add(jsonEncode({
      'event': 'call.invite',
      'data': {
        'callId': '55555555-5555-4555-8555-555555555555',
        'callerId': 'caller',
        'calleeId': 'me',
        'createdAt': DateTime.now().toIso8601String(),
        'caller': {'id': 'caller', 'displayName': 'Caller'},
      },
    }));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    final pending = controller.accept('55555555-5555-4555-8555-555555555555');
    incoming.add(jsonEncode({
      'event': 'call.accept',
      'data': {
        'callId': '55555555-5555-4555-8555-555555555555',
        'acceptedSessionId': 'other-or-self',
      },
    }));
    await pending;
    expect(controller.state.active?.phase, isNot(CallPhase.ended));
    expect(controller.state.active?.isLive, isTrue);
  });

  test('accept on another device ends a still-ringing incoming call', () async {
    final incoming = StreamController<dynamic>.broadcast();
    addTearDown(incoming.close);
    final dio = _dio((options) {
      if (options.path.endsWith('/capabilities')) return {'enabled': true};
      return {};
    });
    late CallController controller;
    final store = SessionStore.memory()..applyTokens(access: 'token');
    final socket = ChatSocket(
      store,
      openChannel: ({required uri, required token}) => ChatSocketConnection(
        stream: incoming.stream,
        add: (_) {},
        close: ([code, reason]) async {},
      ),
    );
    final provider = StateNotifierProvider<CallController, CallState>((ref) {
      controller = CallController(
        ref,
        peerFactory: (_) async => FakePeer(),
        requestMicrophone: () async => true,
      );
      return controller;
    });
    final container = ProviderContainer(
      overrides: [
        sessionStoreProvider.overrideWithValue(store),
        apiClientProvider.overrideWithValue(ApiClient(store, client: dio)),
        chatSocketProvider.overrideWithValue(socket),
      ],
    );
    addTearDown(container.dispose);
    container.read(provider);
    socket.connect();
    await controller.loadCapabilities();
    incoming.add(jsonEncode({
      'event': 'call.invite',
      'data': {
        'callId': '66666666-6666-4666-8666-666666666666',
        'callerId': 'caller',
        'calleeId': 'me',
        'createdAt': DateTime.now().toIso8601String(),
        'caller': {'id': 'caller', 'displayName': 'Caller'},
      },
    }));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    incoming.add(jsonEncode({
      'event': 'call.accept',
      'data': {
        'callId': '66666666-6666-4666-8666-666666666666',
        'acceptedSessionId': 'other-device',
      },
    }));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(controller.state.active?.phase, CallPhase.ended);
  });
}
