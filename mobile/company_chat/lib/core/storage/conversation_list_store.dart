import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

const maxCachedConversations = 40;

class ConversationListStore {
  ConversationListStore({this.readFile, this.writeFile, this.deleteFile});

  final Future<String?> Function(String userId)? readFile;
  final Future<void> Function(String userId, String json)? writeFile;
  final Future<void> Function(String userId)? deleteFile;

  Future<List<Map<String, dynamic>>> load(String? userId) async {
    if (userId == null || userId.isEmpty) return const [];
    try {
      final raw = readFile != null ? await readFile!(userId) : await _readDisk(userId);
      if (raw == null || raw.isEmpty) return const [];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return [
        for (final row in decoded)
          if (row is Map) Map<String, dynamic>.from(row),
      ];
    } catch (_) {
      return const [];
    }
  }

  Future<void> save(String? userId, List<Map<String, dynamic>> rows) async {
    if (userId == null || userId.isEmpty) return;
    final capped = rows.length <= maxCachedConversations ? rows : rows.take(maxCachedConversations).toList();
    final encoded = jsonEncode(capped);
    if (writeFile != null) {
      await writeFile!(userId, encoded);
      return;
    }
    try {
      final file = await _file(userId);
      await file.writeAsString(encoded, flush: true);
    } catch (_) {}
  }

  Future<void> clear(String? userId) async {
    if (userId == null || userId.isEmpty) return;
    if (deleteFile != null) {
      await deleteFile!(userId);
      return;
    }
    try {
      final file = await _file(userId);
      if (file.existsSync()) await file.delete();
    } catch (_) {}
  }

  Future<String?> _readDisk(String userId) async {
    final file = await _file(userId);
    if (!file.existsSync()) return null;
    return file.readAsStringSync();
  }

  Future<File> _file(String userId) async {
    final dir = await getApplicationSupportDirectory();
    final safe = userId.replaceAll(RegExp(r'[^a-zA-Z0-9]'), '');
    return File('${dir.path}/michat_conversations_$safe.json');
  }
}
