import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

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
  AppDatabase() : super(_open());

  @override
  int get schemaVersion => 1;

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
    await into(cachedMessages).insertOnConflictUpdate(
      CachedMessagesCompanion.insert(
        id: id,
        conversationId: conversationId,
        sequenceNumber: Value(message['sequenceNumber'] as int? ?? 0),
        changeSeq: Value(message['changeSeq'] as int? ?? 0),
        payload: jsonEncode(message),
      ),
    );
  }

  Future<void> deleteMessage(String id) async {
    await (delete(cachedMessages)..where((row) => row.id.equals(id))).go();
  }

  Future<void> dropExpired() async {
    final rows = await select(cachedMessages).get();
    for (final row in rows) {
      final payload = jsonDecode(row.payload) as Map<String, dynamic>;
      if (payload['expiredAt'] != null) await deleteMessage(row.id);
    }
  }

  Future<void> replaceConversation(String conversationId, List<Map<String, dynamic>> messages) async {
    await transaction(() async {
      await (delete(cachedMessages)..where((row) => row.conversationId.equals(conversationId))).go();
      for (final message in messages) {
        await upsertMessage(message);
      }
    });
  }
}

QueryExecutor _open() {
  return driftDatabase(name: 'company_chat');
}
