import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/storage/app_database.dart';
import 'package:company_chat/core/storage/conversation_list_store.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:company_chat/core/websocket/chat_socket.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final sessionStoreProvider = Provider<SessionStore>((ref) => SessionStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(ref.watch(sessionStoreProvider));
});

final currentUserIdProvider = StateProvider<String?>((ref) => null);

final conversationListStoreProvider = Provider<ConversationListStore>((ref) {
  return ConversationListStore();
});

final databaseProvider = Provider<AppDatabase>((ref) {
  final userId = ref.watch(currentUserIdProvider);
  final db = AppDatabase(name: AppDatabase.nameFor(userId));
  ref.onDispose(db.close);
  return db;
});

final chatSocketProvider = Provider<ChatSocket>((ref) {
  final socket = ChatSocket(
    ref.watch(sessionStoreProvider),
    refreshSession: () => ref.read(apiClientProvider).refresh(),
  );
  ref.onDispose(socket.disconnect);
  return socket;
});

final onlineUsersProvider = StateProvider<Set<String>>((ref) => <String>{});

final typingProvider = StateProvider<Map<String, Set<String>>>((ref) => {});

final viewedConversationProvider = StateProvider<String?>((ref) => null);

final appLifecycleProvider = StateProvider<AppLifecycleState>((ref) => AppLifecycleState.resumed);

final conversationCacheClearerProvider = Provider<Future<void> Function(String)>((ref) {
  return (id) => ref.read(databaseProvider).clearConversation(id);
});
