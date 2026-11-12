import 'dart:convert';
import 'dart:io';

import 'package:company_chat/core/storage/cache_policy.dart';
import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:path_provider/path_provider.dart';

part 'app_database.g.dart';

class CachedMessages extends Table {
  TextColumn get id => text()();
  TextColumn get conversationId => text()();
  IntColumn get sequenceNumber => integer().withDefault(const Constant(0))();
  IntColumn get changeSeq => integer().withDefault(const Constant(0))();
  TextColumn get payload => text()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

@DriftDatabase(tables: [CachedMessages])
class AppDatabase extends _$AppDatabase {
  AppDatabase({String? name}) : super(_open(name ?? 'company_chat'));

  AppDatabase.connect(super.executor);

  @override
  int get schemaVersion => 1;

  static String nameFor(String? userId) => databaseNameFor(userId);

  static Future<void> deleteStore(String? userId) async {
    final name = nameFor(userId);
    try {
      final dir = await getApplicationSupportDirectory();
      for (final candidate in [
        File('${dir.path}/$name.sqlite'),
        File('${dir.path}/$name'),
      ]) {
        if (await candidate.exists()) await candidate.delete();
      }
    } catch (_) {}
  }

  Future<List<Map<String, dynamic>>> loadMessages(String conversationId) async {
    final rows = await (select(cachedMessages)
          ..where((row) => row.conversationId.equals(conversationId))
          ..orderBy([(row) => OrderingTerm(expression: row.sequenceNumber)]))
        .get();
    return rows
        .map((row) => jsonDecode(row.payload) as Map<String, dynamic>)
        .toList();
  }

  Future<void> upsertMessage(Map<String, dynamic> message) async {
    final id = message['id'] as String?;
    final conversationId = message['conversationId'] as String?;
    if (id == null || conversationId == null) return;
    final clientId = message['clientMessageId'] as String?;
    await transaction(() async {
      if (clientId != null && clientId.isNotEmpty && clientId != id) {
        await (delete(cachedMessages)..where((row) => row.id.equals(clientId))).go();
      }
      await into(cachedMessages).insertOnConflictUpdate(
        CachedMessagesCompanion.insert(
          id: id,
          conversationId: conversationId,
          sequenceNumber: Value(message['sequenceNumber'] as int? ?? 0),
          changeSeq: Value(message['changeSeq'] as int? ?? 0),
          payload: jsonEncode(message),
        ),
      );
    });
  }

  Future<void> deleteMessage(String id) async {
    await (delete(cachedMessages)..where((row) => row.id.equals(id))).go();
  }

  Future<void> dropExpired() async {
    final rows = await select(cachedMessages).get();
    for (final row in rows) {
      final payload = jsonDecode(row.payload) as Map<String, dynamic>;
      if (cachedPayloadExpired(payload)) await deleteMessage(row.id);
    }
  }

  Future<void> clearAll() async {
    await delete(cachedMessages).go();
  }

  Future<void> clearConversation(String conversationId) async {
    await (delete(cachedMessages)..where((row) => row.conversationId.equals(conversationId))).go();
  }

  Future<void> replaceConversation(String conversationId, List<Map<String, dynamic>> messages) async {
    await transaction(() async {
      final existing = await (select(cachedMessages)..where((row) => row.conversationId.equals(conversationId))).get();
      final pending = <Map<String, dynamic>>[];
      for (final row in existing) {
        final payload = jsonDecode(row.payload) as Map<String, dynamic>;
        if (payload['pending'] == true || payload['failed'] == true) pending.add(payload);
      }
      await (delete(cachedMessages)..where((row) => row.conversationId.equals(conversationId))).go();
      for (final message in capCachedMessages(messages)) {
        await upsertMessage(message);
      }
      for (final draft in pending) {
        final already = messages.any((row) =>
            row['id'] == draft['id'] ||
            (draft['clientMessageId'] != null &&
                draft['clientMessageId'] != '' &&
                (row['id'] == draft['clientMessageId'] || row['clientMessageId'] == draft['clientMessageId'])));
        if (!already) await upsertMessage(draft);
      }
    });
  }
}

QueryExecutor _open(String name) {
  return driftDatabase(name: name);
}
