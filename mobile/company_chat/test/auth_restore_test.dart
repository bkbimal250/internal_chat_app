import 'dart:convert';
import 'dart:typed_data';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:company_chat/core/websocket/chat_socket.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const refreshToken = 'RrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRr';

Map<String, dynamic> userJson({String role = 'admin'}) => {
      'id': '11111111-1111-1111-1111-111111111111',
      'username': 'ada',
      'displayName': 'Ada',
      'fullName': 'Ada Lovelace',
      'role': role,
      'status': 'active',
      'mustChangePassword': false,
    };

ResponseBody jsonBody(Object data, int status) {
  return ResponseBody.fromString(
    jsonEncode(data),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );
}

class ScriptedAdapter implements HttpClientAdapter {
  ScriptedAdapter(this.handlers);
  final List<Future<ResponseBody> Function(RequestOptions options)> handlers;
  int calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (calls >= handlers.length) {
      throw DioException(requestOptions: options, error: 'unexpected ${options.path}');
    }
    return handlers[calls++](options);
  }

  @override
  void close({bool force = false}) {}
}

ProviderContainer appContainer({
  required SessionStore store,
  required ApiClient api,
}) {
  final socket = ChatSocket(
    store,
    openChannel: ({required uri, required token}) => ChatSocketConnection(
      stream: const Stream.empty(),
      add: (_) {},
      close: ([int? code, String? reason]) async {},
    ),
  );
  return ProviderContainer(
    overrides: [
      sessionStoreProvider.overrideWithValue(store),
      apiClientProvider.overrideWithValue(api),
      chatSocketProvider.overrideWithValue(socket),
    ],
  );
}

Future<void> _waitFor(
  ProviderContainer container,
  bool Function(AuthState auth) predicate,
) async {
  for (var i = 0; i < 50; i++) {
    if (predicate(container.read(authControllerProvider))) return;
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
  fail('auth did not settle: ${container.read(authControllerProvider).status}');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('restores an authenticated session after restart', () async {
    final store = SessionStore.memory();
    await store.writeRefreshToken(refreshToken);
    final dio = Dio(BaseOptions(baseUrl: 'https://api.michat.in'))
      ..httpClientAdapter = ScriptedAdapter([
        (options) async {
          expect(options.path, '/api/v1/auth/refresh');
          return jsonBody({
            'accessToken': 'restored',
            'refreshToken': 's' * 64,
            'sessionId': '22222222-2222-2222-2222-222222222222',
            'deviceId': '33333333-3333-3333-3333-333333333333',
            'expiresIn': 900,
            'user': userJson(),
          }, 200);
        },
        (options) async {
          expect(options.path, '/api/v1/auth/me');
          return jsonBody(userJson(), 200);
        },
        (options) async => jsonBody({
              'messagesEnabled': true,
              'sound': true,
              'vibration': true,
              'showPreview': true,
              'showSenderOnLockScreen': true,
              'groupNotifications': true,
              'retentionReminders': true,
              'mutedConversationIds': [],
            }, 200),
      ]);
    final container = appContainer(store: store, api: ApiClient(store, client: dio));
    addTearDown(container.dispose);

    container.read(authControllerProvider.notifier);
    await _waitFor(container, (auth) => auth.status != AuthStatus.unknown);
    final auth = container.read(authControllerProvider);
    expect(auth.status, AuthStatus.authenticated);
    expect(auth.isAdmin, isTrue);
    expect(store.accessToken, 'restored');
    expect(await store.readRefreshToken(), 's' * 64);
  });

  test('keeps credentials when restore cannot reach the API', () async {
    final store = SessionStore.memory();
    await store.writeRefreshToken(refreshToken);
    store.applyTokens(access: 'cached');
    final dio = Dio(BaseOptions(baseUrl: 'https://api.michat.in'))
      ..httpClientAdapter = ScriptedAdapter([
        (options) async {
          throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
            error: 'offline',
          );
        },
      ]);
    final container = appContainer(store: store, api: ApiClient(store, client: dio));
    addTearDown(container.dispose);

    container.read(authControllerProvider.notifier);
    await _waitFor(container, (auth) => auth.status != AuthStatus.unknown);
    final auth = container.read(authControllerProvider);
    expect(auth.status, AuthStatus.unavailable);
    expect(auth.isAuthenticated, isFalse);
    expect(await store.readRefreshToken(), refreshToken);
  });

  test('revoked sessions return to login', () async {
    final store = SessionStore.memory();
    await store.writeRefreshToken(refreshToken);
    final dio = Dio(BaseOptions(baseUrl: 'https://api.michat.in'))
      ..httpClientAdapter = ScriptedAdapter([
        (options) async => jsonBody({
              'error': {'code': 'INVALID_SESSION', 'message': 'revoked', 'requestId': 't'},
            }, 401),
      ]);
    final container = appContainer(store: store, api: ApiClient(store, client: dio));
    addTearDown(container.dispose);

    container.read(authControllerProvider.notifier);
    await _waitFor(container, (auth) => auth.status != AuthStatus.unknown);
    expect(container.read(authControllerProvider).status, AuthStatus.anonymous);
    expect(await store.readRefreshToken(), isNull);
  });
}
