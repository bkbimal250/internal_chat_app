import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/storage/conversation_list_store.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:company_chat/core/utils/preview_text.dart';
import 'package:company_chat/core/websocket/chat_socket.dart';
import 'package:company_chat/features/conversations/conversation_actions.dart';
import 'package:company_chat/features/conversations/hide_chats_dialog.dart';
import 'package:company_chat/features/conversations/presentation/conversations_controller.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
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
  int unread = 0,
  String updatedAt = '2026-11-12T00:00:00.000Z',
  String? pinnedAt,
  String? archivedAt,
  String? mutedUntil,
}) {
  return {
    'id': id,
    'type': 'direct',
    'updatedAt': updatedAt,
    'unreadCount': unread,
    'lastMessageSeq': 4,
    'pinnedAt': pinnedAt,
    'archivedAt': archivedAt,
    'mutedUntil': mutedUntil,
    'latestMessage': {'content': id, 'sequenceNumber': 4, 'createdAt': updatedAt},
    'members': [
      {'id': 'peer', 'displayName': 'Peer', 'fullName': 'Deleted employee'},
    ],
  };
}

class ScriptedAdapter implements HttpClientAdapter {
  ScriptedAdapter(this.handler);
  final Future<ResponseBody> Function(RequestOptions options) handler;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) {
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody jsonBody(Object data, [int status = 200]) {
  return ResponseBody.fromString(
    jsonEncode(data),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );
}

ProviderContainer cacheContainer({
  required ConversationListStore lists,
  required ApiClient api,
}) {
  final store = SessionStore.memory();
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

  test('pinned chats sort above recent unpinned chats', () {
    final rows = [
      chat(id: 'new', updatedAt: '2026-11-12T12:00:00.000Z'),
      chat(id: 'old-pinned', updatedAt: '2026-11-01T00:00:00.000Z', pinnedAt: '2026-11-12T00:00:00.000Z'),
    ];
    expect(sortConversations(rows).map((row) => row['id']), ['old-pinned', 'new']);
  });

  testWidgets('wide toolbar shows pin, mute, delete and archive', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          appBar: AppBar(
            actions: [
              ChatSelectionActions(
                snapshot: ChatSelectionSnapshot([chat(id: 'a'), chat(id: 'b', unread: 2)]),
                compact: false,
                busy: false,
                onPin: () {},
                onMute: () {},
                onDelete: () {},
                onArchive: () {},
                onMarkRead: () {},
                onMarkUnread: () {},
              ),
            ],
          ),
        ),
      ),
    );
    expect(find.byTooltip('Pin'), findsOneWidget);
    expect(find.byTooltip('Mute'), findsOneWidget);
    expect(find.byTooltip('Delete'), findsOneWidget);
    expect(find.byTooltip('Archive'), findsOneWidget);
    expect(find.byTooltip('More'), findsOneWidget);
  });

  testWidgets('narrow toolbar keeps delete and moves pin into more', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          appBar: AppBar(
            actions: [
              ChatSelectionActions(
                snapshot: ChatSelectionSnapshot([chat(id: 'a')]),
                compact: true,
                busy: false,
                onPin: () {},
                onMute: () {},
                onDelete: () {},
                onArchive: () {},
              ),
            ],
          ),
        ),
      ),
    );
    expect(find.byTooltip('Delete'), findsOneWidget);
    expect(find.byTooltip('Pin'), findsNothing);
    expect(find.byTooltip('Archive'), findsNothing);
    expect(find.byTooltip('More'), findsOneWidget);
    await tester.tap(find.byTooltip('More'));
    await tester.pumpAndSettle();
    expect(find.text('Pin'), findsOneWidget);
    expect(find.text('Mute'), findsOneWidget);
    expect(find.text('Archive'), findsOneWidget);
  });

  testWidgets('delete confirmation can be cancelled', (tester) async {
    var confirmed = true;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              confirmed = await confirmHideChats(context, count: 2);
            },
            child: const Text('Go'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Go'));
    await tester.pumpAndSettle();
    expect(find.text('Delete 2 chats?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(confirmed, isFalse);
  });

  test('pin, archive, hide and restart keep cache consistent', () async {
    const userId = 'user-actions';
    final files = <String, String>{};
    final lists = memoryListStore(files);
    await lists.save(userId, [chat(id: 'keep'), chat(id: 'gone'), chat(id: 'hold')]);
    final gate = Completer<void>();
    addTearDown(() {
      if (!gate.isCompleted) gate.complete();
    });

    final dio = Dio(BaseOptions(baseUrl: 'https://api.michat.in'))
      ..httpClientAdapter = ScriptedAdapter((options) async {
        if (options.path == '/api/v1/conversations' && options.method == 'GET') {
          final archived = options.queryParameters['archived'] == true || options.queryParameters['archived'] == 'true';
          await gate.future;
          if (archived) {
            return jsonBody({
              'data': [chat(id: 'hold', archivedAt: '2026-11-12T01:00:00.000Z')],
              'nextCursor': null,
            });
          }
          return jsonBody({
            'data': [chat(id: 'keep', pinnedAt: '2026-11-12T01:00:00.000Z')],
            'nextCursor': null,
          });
        }
        if (options.path.endsWith('/conversations/keep/pin')) {
          return jsonBody({'id': 'keep', 'pinned': true, 'pinnedAt': '2026-11-12T01:00:00.000Z'});
        }
        if (options.path.endsWith('/conversations/hold/archive')) {
          return jsonBody({'id': 'hold', 'archived': true, 'archivedAt': '2026-11-12T01:00:00.000Z'});
        }
        if (options.path.endsWith('/conversations/gone/hide')) {
          return jsonBody({'id': 'gone', 'hiddenUntilSeq': 4, 'success': true});
        }
        if (options.path.endsWith('/conversations/missing/pin')) {
          return jsonBody({
            'error': {'code': 'NOT_FOUND', 'message': 'Conversation not found'},
          }, 404);
        }
        throw DioException(requestOptions: options, error: 'unexpected ${options.method} ${options.path}');
      });

    final container = cacheContainer(lists: lists, api: ApiClient(SessionStore.memory(), client: dio));
    addTearDown(container.dispose);
    container.read(currentUserIdProvider.notifier).state = userId;
    container.read(conversationsControllerProvider);
    await waitFor(() => container.read(conversationsControllerProvider).items.length == 3);

    final controller = container.read(conversationsControllerProvider.notifier);
    await controller.pinConversations(['keep'], pinned: true);
    await controller.archiveConversations(['hold'], archived: true);
    await controller.hideConversations(['gone']);

    final state = container.read(conversationsControllerProvider);
    expect(state.items.map((row) => row['id']), ['keep']);
    expect(state.archivedItems.map((row) => row['id']), ['hold']);
    expect(isPinned(state.items.single), isTrue);
    expect((await lists.load(userId)).map((row) => row['id']).toSet(), {'keep', 'hold'});

    final failed = await controller.pinConversations(['missing'], pinned: true);
    expect(failed.failed.single.id, 'missing');
    expect(container.read(conversationsControllerProvider).items.map((row) => row['id']), ['keep']);

    container.dispose();
    final restart = cacheContainer(lists: lists, api: ApiClient(SessionStore.memory(), client: dio));
    addTearDown(restart.dispose);
    restart.read(currentUserIdProvider.notifier).state = userId;
    restart.read(conversationsControllerProvider);
    await waitFor(() => restart.read(conversationsControllerProvider).items.isNotEmpty);
    final restored = restart.read(conversationsControllerProvider);
    expect(restored.items.map((row) => row['id']), ['keep']);
    expect(restored.archivedItems.map((row) => row['id']), ['hold']);
    expect(restored.items.single['members'].first['fullName'], 'Deleted employee');
  });

  test('mixed mute and unread snapshot drives toolbar labels', () {
    final snapshot = ChatSelectionSnapshot([
      chat(id: 'a', unread: 2, mutedUntil: '9999-12-31T00:00:00.000Z'),
      chat(id: 'b'),
    ]);
    expect(snapshot.allMuted, isFalse);
    expect(snapshot.anyMuted, isTrue);
    expect(snapshot.anyUnread, isTrue);
    expect(snapshot.anyRead, isTrue);
    expect(snapshot.allPinned, isFalse);
  });
}
