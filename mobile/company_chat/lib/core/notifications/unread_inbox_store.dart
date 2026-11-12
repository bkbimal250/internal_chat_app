import 'dart:convert';
import 'dart:io';

import 'package:company_chat/core/notifications/unread_inbox.dart';
import 'package:path_provider/path_provider.dart';

class UnreadInboxStore {
  UnreadInboxStore({this.readFile, this.writeFile, this.deleteFile});

  final Future<String?> Function(String? userId)? readFile;
  final Future<void> Function(String? userId, String json)? writeFile;
  final Future<void> Function(String? userId)? deleteFile;
  String? userId;

  Future<UnreadInbox> load() async {
    try {
      final raw = readFile != null
          ? await readFile!(userId)
          : await _file().then((file) {
              if (!file.existsSync()) return null;
              return file.readAsStringSync();
            });
      if (raw == null || raw.isEmpty) return const UnreadInbox();
      final inbox = UnreadInbox.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      if (userId != null && inbox.userId != null && inbox.userId != userId) {
        return const UnreadInbox();
      }
      return inbox;
    } catch (_) {
      return const UnreadInbox();
    }
  }

  Future<void> save(UnreadInbox inbox) async {
    final encoded = jsonEncode(inbox.toJson());
    if (writeFile != null) {
      await writeFile!(userId, encoded);
      return;
    }
    try {
      final file = await _file();
      await file.writeAsString(encoded, flush: true);
    } catch (_) {}
  }

  Future<UnreadInbox> update(UnreadInbox Function(UnreadInbox current) fn) async {
    final next = fn(await load());
    await save(next);
    return next;
  }

  Future<void> clear([String? id]) async {
    final target = id ?? userId;
    if (deleteFile != null) {
      await deleteFile!(target);
      return;
    }
    try {
      final previous = userId;
      userId = target;
      final file = await _file();
      if (file.existsSync()) await file.delete();
      userId = previous;
    } catch (_) {}
  }

  Future<File> _file() async {
    final dir = await getApplicationSupportDirectory();
    final suffix = (userId == null || userId!.isEmpty) ? '' : '_${userId!.replaceAll(RegExp(r'[^A-Za-z0-9]'), '')}';
    return File('${dir.path}/michat_unread_inbox$suffix.json');
  }
}

final unreadInboxStore = UnreadInboxStore();
