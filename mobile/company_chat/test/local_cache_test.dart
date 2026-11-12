import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/storage/cache_policy.dart';
import 'package:company_chat/core/storage/conversation_list_store.dart';
import 'package:company_chat/core/storage/media_cache.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:company_chat/core/websocket/chat_socket.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/conversations/presentation/conversations_controller.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

ConversationListStore memoryListStore(Map<String, String> files) {
  return ConversationListStore(
    readFile: (id) async => files[id],
    writeFile: (id, json) async => files[id] = json,
    deleteFile: (id) async => files.remove(id),
  );
}

Map<String, dynamic> chat({
  required String id,
  String preview = 'hello',
  int unread = 0,
  String updatedAt = '2026-11-12T00:00:00.000Z',
}) {
  return {
    'id': id,
    'type': 'direct',
    'updatedAt': updatedAt,
    'unreadCount': unread,
    'latestMessage': {'content': preview, 'sequenceNumber': 1, 'createdAt': updatedAt},
    'members': [
      {'id': 'peer', 'displayName': 'Peer', 'fullName': 'Peer User'},
    ],
  };
}

class ScriptedAdapter implements HttpClientAdapter {
  ScriptedAdapter(this.handler);
  final Future<ResponseBody> Function(RequestOptions options) handler;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ProviderContainer cacheContainer({
  required ConversationListStore lists,
  required ApiClient api,
  SessionStore? session,
}) {
  final store = session ?? SessionStore.memory();
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
      conversationListStoreProvider.overrideWithValue(lists),
      conversationCacheClearerProvider.overrideWithValue((_) async {}),
    ],
  );
}

Future<void> waitFor(bool Function() ready) async {
  for (var i = 0; i < 80; i++) {
    if (ready()) return;
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
  fail('condition not met');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('conversation list cache is isolated by account and capped', () async {
    final files = <String, String>{};
    final store = memoryListStore(files);
    await store.save('user-a', [chat(id: 'a1'), chat(id: 'a2')]);
    await store.save('user-b', [chat(id: 'b1', preview: 'other')]);

    final a = await store.load('user-a');
    final b = await store.load('user-b');
    expect(a.map((row) => row['id']), ['a1', 'a2']);
    expect(b.single['id'], 'b1');
    expect(await store.load('user-c'), isEmpty);

    await store.clear('user-a');
    expect(await store.load('user-a'), isEmpty);
    expect((await store.load('user-b')).single['id'], 'b1');

    await store.save('user-b', [for (var i = 0; i < 50; i++) chat(id: 'c$i')]);
    expect((await store.load('user-b')).length, maxCachedConversations);
  });

  test('expired cached messages drop only after expiry', () {
    final now = DateTime.utc(2026, 11, 12, 12);
    expect(cachedPayloadExpired({'content': 'live'}, now), isFalse);
    expect(cachedPayloadExpired({'expiredAt': '2026-11-12T11:00:00.000Z'}, now), isTrue);
    expect(cachedPayloadExpired({'expiredAt': '2026-11-12T13:00:00.000Z'}, now), isFalse);
    expect(capCachedMessages([for (var i = 1; i <= 250; i++) {'sequenceNumber': i}]).first['sequenceNumber'], 51);
    expect(databaseNameFor('11111111-1111-1111-1111-111111111111'), 'company_chat_11111111111111111111111111111111');
    expect(databaseNameFor(null), 'company_chat_anon');
  });

  test('avatar cache keys stay stable when signed URLs rotate', () {
    expect(
      avatarCacheKey(id: 'u1', version: 'v2'),
      avatarCacheKey(id: 'u1', version: 'v2'),
    );
    expect(avatarCacheKey(id: 'u1', version: 'v1') == avatarCacheKey(id: 'u1', version: 'v2'), isFalse);
    expect(thumbCacheKey('att-1'), 'thumb:att-1');
  });

  test('startup shows cached chats then refreshes from the network once', () async {
    const userId = 'user-cache-1';
    final files = <String, String>{};
    final lists = memoryListStore(files);
    await lists.save(userId, [chat(id: 'c1', preview: 'cached', unread: 3)]);

    final gate = Completer<void>();
    var conversationGets = 0;
    final dio = Dio(BaseOptions(baseUrl: 'https://api.michat.in'))
      ..httpClientAdapter = ScriptedAdapter((options) async {
        if (options.path == '/api/v1/conversations') {
          conversationGets += 1;
          await gate.future;
          return ResponseBody.fromString(
            jsonEncode({
              'data': [chat(id: 'c1', preview: 'fresh', unread: 0, updatedAt: '2026-11-12T01:00:00.000Z')],
              'nextCursor': null,
            }),
            200,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        }
        throw DioException(requestOptions: options, error: 'unexpected ${options.path}');
      });

    final session = SessionStore.memory();
    final container = cacheContainer(lists: lists, api: ApiClient(session, client: dio), session: session);
    addTearDown(container.dispose);
    container.read(currentUserIdProvider.notifier).state = userId;
    container.read(conversationsControllerProvider);

    await waitFor(() => container.read(conversationsControllerProvider).items.isNotEmpty);
    expect(container.read(conversationsControllerProvider).items.single['latestMessage']['content'], 'cached');
    expect(container.read(conversationsControllerProvider).items.single['unreadCount'], 3);
    await waitFor(() => conversationGets == 1);

    container.read(conversationsControllerProvider.notifier).load();
    expect(conversationGets, 1);

    gate.complete();
    await waitFor(() {
      final items = container.read(conversationsControllerProvider).items;
      return items.isNotEmpty && items.single['latestMessage']['content'] == 'fresh';
    });
    expect(container.read(conversationsControllerProvider).items.single['unreadCount'], 0);
    expect(conversationGets, 1);
    expect(jsonDecode(files[userId]!)[0]['latestMessage']['content'], 'fresh');
  });

  test('account switch does not show the previous user chat list', () async {
    final files = <String, String>{};
    final lists = memoryListStore(files);
    await lists.save('user-a', [chat(id: 'only-a', preview: 'secret')]);
    await lists.save('user-b', [chat(id: 'only-b', preview: 'ok')]);

    final hang = Completer<void>();
    addTearDown(() {
      if (!hang.isCompleted) hang.complete();
    });
    final dio = Dio(BaseOptions(baseUrl: 'https://api.michat.in'))
      ..httpClientAdapter = ScriptedAdapter((options) async {
        if (options.path == '/api/v1/conversations') {
          await hang.future;
          return ResponseBody.fromString(
            jsonEncode({'data': <Map<String, dynamic>>[], 'nextCursor': null}),
            200,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        }
        throw DioException(requestOptions: options, error: 'unexpected ${options.path}');
      });
    final session = SessionStore.memory();
    final container = cacheContainer(lists: lists, api: ApiClient(session, client: dio), session: session);
    addTearDown(container.dispose);

    container.read(currentUserIdProvider.notifier).state = 'user-a';
    container.read(conversationsControllerProvider);
    await waitFor(() => container.read(conversationsControllerProvider).items.any((row) => row['id'] == 'only-a'));
    expect(container.read(conversationsControllerProvider).items.single['latestMessage']['content'], 'secret');

    container.read(currentUserIdProvider.notifier).state = 'user-b';
    await waitFor(() {
      final items = container.read(conversationsControllerProvider).items;
      return items.length == 1 && items.single['id'] == 'only-b';
    });
    expect(container.read(conversationsControllerProvider).items.single['latestMessage']['content'], 'ok');
    expect(container.read(conversationsControllerProvider).items.any((row) => row['id'] == 'only-a'), isFalse);
  });

  test('hidden chats stay out of the persisted list and are not restored from stale cache', () async {
    const userId = 'user-hide';
    final files = <String, String>{};
    final lists = memoryListStore(files);
    await lists.save(userId, [chat(id: 'keep'), chat(id: 'gone')]);
    final gate = Completer<void>();
    addTearDown(() {
      if (!gate.isCompleted) gate.complete();
    });

    final dio = Dio(BaseOptions(baseUrl: 'https://api.michat.in'))
      ..httpClientAdapter = ScriptedAdapter((options) async {
        if (options.path == '/api/v1/conversations' && options.method == 'GET') {
          await gate.future;
          return ResponseBody.fromString(
            jsonEncode({
              'data': [chat(id: 'keep')],
              'nextCursor': null,
            }),
            200,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        }
        if (options.path.endsWith('/conversations/gone/hide')) {
          return ResponseBody.fromString(
            jsonEncode({'id': 'gone', 'hiddenUntilSeq': 4, 'success': true}),
            200,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        }
        throw DioException(requestOptions: options, error: 'unexpected ${options.method} ${options.path}');
      });
    final session = SessionStore.memory();
    final container = cacheContainer(lists: lists, api: ApiClient(session, client: dio), session: session);
    addTearDown(container.dispose);
    container.read(currentUserIdProvider.notifier).state = userId;
    container.read(conversationsControllerProvider);
    await waitFor(() => container.read(conversationsControllerProvider).items.length == 2);

    await container.read(conversationsControllerProvider.notifier).hideConversations(['gone']);
    expect(container.read(conversationsControllerProvider).items.map((row) => row['id']), ['keep']);
    expect((await lists.load(userId)).map((row) => row['id']), ['keep']);
    container.dispose();

    final restart = cacheContainer(lists: lists, api: ApiClient(SessionStore.memory(), client: dio));
    addTearDown(restart.dispose);
    restart.read(currentUserIdProvider.notifier).state = userId;
    restart.read(conversationsControllerProvider);
    await waitFor(() => restart.read(conversationsControllerProvider).items.isNotEmpty);
    expect(restart.read(conversationsControllerProvider).items.map((row) => row['id']), ['keep']);
  });

  test('logout clears the account conversation cache', () async {
    const userId = 'user-logout';
    final files = <String, String>{};
    final lists = memoryListStore(files);
    await lists.save(userId, [chat(id: 'private')]);
    final session = SessionStore.memory();
    await session.writeUserId(userId);
    final dio = Dio(BaseOptions(baseUrl: 'https://api.michat.in'))
      ..httpClientAdapter = ScriptedAdapter((options) async {
        return ResponseBody.fromString('{}', 200, headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        });
      });
    final container = cacheContainer(lists: lists, api: ApiClient(session, client: dio), session: session);
    addTearDown(container.dispose);
    container.read(currentUserIdProvider.notifier).state = userId;
    await container.read(authControllerProvider.notifier).logout();
    expect(await lists.load(userId), isEmpty);
    expect(container.read(currentUserIdProvider), isNull);
  });
}
