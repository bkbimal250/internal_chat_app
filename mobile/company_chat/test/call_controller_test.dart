import 'dart:async';

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
    expect(controller.state.active?.phase, CallPhase.ringing);
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
}
