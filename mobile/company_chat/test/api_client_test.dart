import 'dart:convert';
import 'dart:typed_data';

import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

const refreshToken = 'RrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRrRr';

Map<String, dynamic> userJson() => {
      'id': '11111111-1111-1111-1111-111111111111',
      'username': 'ada',
      'displayName': 'Ada',
      'fullName': 'Ada Lovelace',
      'role': 'admin',
      'status': 'active',
      'mustChangePassword': false,
    };

Map<String, dynamic> sessionJson({String access = 'access-1', String refresh = refreshToken}) => {
      'accessToken': access,
      'refreshToken': refresh,
      'sessionId': '22222222-2222-2222-2222-222222222222',
      'deviceId': '33333333-3333-3333-3333-333333333333',
      'expiresIn': 900,
      'tokenType': 'Bearer',
      'user': userJson(),
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
  final requests = <RequestOptions>[];
  int calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    if (calls >= handlers.length) {
      throw DioException(requestOptions: options, error: 'unexpected ${options.path}');
    }
    return handlers[calls++](options);
  }

  @override
  void close({bool force = false}) {}
}

ApiClient buildClient(SessionStore store, ScriptedAdapter adapter) {
  final dio = Dio(BaseOptions(baseUrl: 'https://api.michat.in'));
  dio.httpClientAdapter = adapter;
  return ApiClient(store, client: dio);
}

void main() {
  test('username login stores the rotated refresh token securely and the access token in memory', () async {
    final store = SessionStore.memory();
    final client = buildClient(
      store,
      ScriptedAdapter([
        (options) async {
          expect(options.path, '/api/v1/auth/login');
          final body = options.data as Map;
          expect(body['clientType'], 'native');
          expect(body['username'], 'ada');
          expect(body.containsKey('password'), isTrue);
          return jsonBody(sessionJson(), 200);
        },
      ]),
    );

    await client.login(username: 'ada', password: 'not-stored');
    expect(store.accessToken, 'access-1');
    expect(await store.readRefreshToken(), refreshToken);
    expect(store.accessToken, isNot(equals(await store.readRefreshToken())));
  });

  test('single-flight refresh rotates the native refresh token', () async {
    final store = SessionStore.memory();
    await store.writeRefreshToken(refreshToken);
    var refreshCalls = 0;
    final client = buildClient(
      store,
      ScriptedAdapter([
        (options) async {
          refreshCalls += 1;
          expect(options.path, '/api/v1/auth/refresh');
          expect(options.headers['Authorization'], isNull);
          final body = options.data as Map;
          expect(body['clientType'], 'native');
          expect(body['refreshToken'], refreshToken);
          await Future<void>.delayed(const Duration(milliseconds: 20));
          return jsonBody(sessionJson(access: 'access-2', refresh: 'n' * 64), 200);
        },
      ]),
    );

    final results = await Future.wait([client.refresh(), client.refresh()]);
    expect(refreshCalls, 1);
    expect(results.first['accessToken'], 'access-2');
    expect(store.accessToken, 'access-2');
    expect(await store.readRefreshToken(), 'n' * 64);
  });

  test('expired access tokens refresh once and retry the original request', () async {
    final store = SessionStore.memory();
    store.applyTokens(access: 'expired');
    await store.writeRefreshToken(refreshToken);
    final client = buildClient(
      store,
      ScriptedAdapter([
        (options) async {
          expect(options.path, '/api/v1/conversations');
          return jsonBody({
            'error': {'code': 'INVALID_SESSION', 'message': 'expired', 'requestId': 't'},
          }, 401);
        },
        (options) async {
          expect(options.path, '/api/v1/auth/refresh');
          return jsonBody(sessionJson(access: 'next'), 200);
        },
        (options) async {
          expect(options.path, '/api/v1/conversations');
          expect(options.headers['Authorization'], 'Bearer next');
          return jsonBody({
            'data': [],
            'page': 1,
            'limit': 100,
            'total': 0,
          }, 200);
        },
      ]),
    );

    final data = await client.get<Map<String, dynamic>>('/api/v1/conversations');
    expect(data['total'], 0);
    expect(store.accessToken, 'next');
  });

  test('network failures during refresh do not clear the session', () async {
    final store = SessionStore.memory();
    store.applyTokens(access: 'still-here');
    await store.writeRefreshToken(refreshToken);
    final client = buildClient(
      store,
      ScriptedAdapter([
        (options) async {
          throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
            error: 'offline',
          );
        },
      ]),
    );

    await expectLater(
      client.refresh(),
      throwsA(isA<ApiError>().having((error) => error.isSessionInvalid, 'session', isFalse)),
    );
    expect(store.accessToken, 'still-here');
    expect(await store.readRefreshToken(), refreshToken);
  });

  test('revoked refresh tokens clear stored credentials', () async {
    final store = SessionStore.memory();
    store.applyTokens(access: 'gone');
    await store.writeRefreshToken(refreshToken);
    final client = buildClient(
      store,
      ScriptedAdapter([
        (options) async => jsonBody({
              'error': {'code': 'INVALID_SESSION', 'message': 'revoked', 'requestId': 't'},
            }, 401),
      ]),
    );

    await expectLater(
      client.refresh(),
      throwsA(isA<ApiError>().having((error) => error.isSessionInvalid, 'session', isTrue)),
    );
    expect(store.accessToken, isNull);
    expect(await store.readRefreshToken(), isNull);
  });
}
