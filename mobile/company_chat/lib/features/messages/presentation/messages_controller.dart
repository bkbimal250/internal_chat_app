import 'dart:async';
import 'dart:io';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/storage/cache_policy.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/media/media_limits.dart';
import 'package:company_chat/features/media/media_prepare.dart';
import 'package:company_chat/features/media/media_upload.dart';
import 'package:company_chat/features/media/transfer_runtime.dart';
import 'package:company_chat/features/messages/message_actions.dart';
import 'package:company_chat/features/messages/message_identity.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

class MessagesState {
  const MessagesState({
    this.messages = const [],
    this.details,
    this.retention,
    this.receipts = const [],
    this.loading = true,
    this.replyTo,
    this.editing,
    this.uploading = false,
    this.uploadProgress = 0,
    this.uploadLabel = '',
    this.uploadOriginalSize = 0,
    this.uploadCompressedSize = 0,
    this.uploadEta,
    this.hasOlder = false,
    this.loadingOlder = false,
  });

  final List<Map<String, dynamic>> messages;
  final Map<String, dynamic>? details;
  final Map<String, dynamic>? retention;
  final List<Map<String, dynamic>> receipts;
  final bool loading;
  final Map<String, dynamic>? replyTo;
  final Map<String, dynamic>? editing;
  final bool uploading;
  final int uploadProgress;
  final String uploadLabel;
  final int uploadOriginalSize;
  final int uploadCompressedSize;
  final Duration? uploadEta;
  final bool hasOlder;
  final bool loadingOlder;

  MessagesState copyWith({
    List<Map<String, dynamic>>? messages,
    Map<String, dynamic>? details,
    Map<String, dynamic>? retention,
    List<Map<String, dynamic>>? receipts,
    bool? loading,
    Map<String, dynamic>? replyTo,
    Map<String, dynamic>? editing,
    bool? uploading,
    int? uploadProgress,
    String? uploadLabel,
    int? uploadOriginalSize,
    int? uploadCompressedSize,
    Duration? uploadEta,
    bool? hasOlder,
    bool? loadingOlder,
    bool clearReply = false,
    bool clearEditing = false,
    bool clearEta = false,
  }) {
    return MessagesState(
      messages: messages ?? this.messages,
      details: details ?? this.details,
      retention: retention ?? this.retention,
      receipts: receipts ?? this.receipts,
      loading: loading ?? this.loading,
      replyTo: clearReply ? null : (replyTo ?? this.replyTo),
      editing: clearEditing ? null : (editing ?? this.editing),
      uploading: uploading ?? this.uploading,
      uploadProgress: uploadProgress ?? this.uploadProgress,
      uploadLabel: uploadLabel ?? this.uploadLabel,
      uploadOriginalSize: uploadOriginalSize ?? this.uploadOriginalSize,
      uploadCompressedSize: uploadCompressedSize ?? this.uploadCompressedSize,
      uploadEta: clearEta ? null : (uploadEta ?? this.uploadEta),
      hasOlder: hasOlder ?? this.hasOlder,
      loadingOlder: loadingOlder ?? this.loadingOlder,
    );
  }
}

class MessagesController extends StateNotifier<MessagesState> {
  MessagesController(this._ref, this.conversationId) : super(const MessagesState()) {
    _sub = _ref.read(chatSocketProvider).events.listen(_onEvent);
    _userSub = _ref.listen<String?>(currentUserIdProvider, (previous, next) {
      if (previous == next) return;
      _loading = null;
      state = const MessagesState();
      if (next != null && next.isNotEmpty) load();
    });
    load();
  }

  final Ref _ref;
  final String conversationId;
  StreamSubscription<Map<String, dynamic>>? _sub;
  ProviderSubscription<String?>? _userSub;
  Future<void>? _loading;
  ApiClient get _api => _ref.read(apiClientProvider);

  Future<void> load() => _loading ??= _load().whenComplete(() => _loading = null);

  Future<void> _load() async {
    try {
      await _ref.read(databaseProvider).dropExpired();
      final cached = _live(await _ref.read(databaseProvider).loadMessages(conversationId));
      if (cached.isNotEmpty) {
        state = state.copyWith(messages: _sort(cached), loading: false);
      }
      final details = await _api.get<Map<String, dynamic>>('/api/v1/conversations/$conversationId');
      final lastSeq = (details['lastMessageSeq'] as num?)?.toInt() ?? 0;
      final afterSeq = lastSeq > 80 ? lastSeq - 80 : 0;
      final page = await _api.get<Map<String, dynamic>>(
        '/api/v1/conversations/$conversationId/messages',
        query: {'afterSeq': afterSeq, 'limit': 80},
      );
      final pending = cached.where((row) => row['pending'] == true);
      final latestWindow = cached.where((row) {
        final seq = (row['sequenceNumber'] as num?)?.toInt() ?? 0;
        return seq >= afterSeq || row['pending'] == true;
      });
      var messages = _live(
        _merge(
          collapseDuplicateMessages([...state.messages, ...latestWindow, ...pending]),
          ((page['data'] as List?) ?? []).cast<Map>().map(Map<String, dynamic>.from),
        ),
      );
      final lastChange = cached
          .map((row) => row['changeSeq'] as int? ?? 0)
          .fold<int>(0, (a, b) => a > b ? a : b);
      final synced = await _api.get<Map<String, dynamic>>(
        '/api/v1/conversations/$conversationId/sync',
        query: {'afterChangeSeq': lastChange > 0 ? lastChange : 0, 'limit': 100},
      );
      messages = _live(_merge(messages, ((synced['data'] as List?) ?? []).cast<Map>().map(Map<String, dynamic>.from)));
      Map<String, dynamic>? retention;
      try {
        retention = await _api.get<Map<String, dynamic>>('/api/v1/conversations/$conversationId/retention');
      } catch (_) {}
      final receipts = await _api.get<dynamic>('/api/v1/conversations/$conversationId/receipts');
      final receiptRows = receipts is List
          ? receipts.cast<Map>().map(Map<String, dynamic>.from).toList()
          : ((receipts as Map?)?['data'] as List? ?? []).cast<Map>().map(Map<String, dynamic>.from).toList();
      await _ref.read(databaseProvider).replaceConversation(conversationId, messages);
      state = state.copyWith(
        details: details,
        retention: retention,
        messages: _sort(messages),
        receipts: receiptRows,
        loading: false,
        hasOlder: _minSeq(messages) > 1,
      );
      _markRead();
      unawaited(_resumePending(messages));
    } catch (_) {
      state = state.copyWith(loading: false);
    }
  }

  Future<void> send(String content) async {
    final text = content.trim();
    if (text.isEmpty) return;
    final me = _ref.read(authControllerProvider).user;
    if (state.editing != null) {
      final updated = await _api.patch<Map<String, dynamic>>(
        '/api/v1/messages/${state.editing!['id']}',
        data: {'content': text},
      );
      _upsert(updated);
      state = state.copyWith(clearEditing: true);
      return;
    }
    final clientMessageId = const Uuid().v4();
    final optimistic = {
      'id': clientMessageId,
      'clientMessageId': clientMessageId,
      'conversationId': conversationId,
      'senderId': me?.id,
      'content': text,
      'messageType': 'text',
      'createdAt': DateTime.now().toUtc().toIso8601String(),
      'pending': true,
      'replyToMessageId': state.replyTo?['id'],
    };
    _upsert(optimistic);
    await _ref.read(databaseProvider).upsertMessage(optimistic);
    final quoted = state.replyTo;
    state = state.copyWith(clearReply: true);
    try {
      final saved = await _api.post<Map<String, dynamic>>(
        '/api/v1/conversations/$conversationId/messages',
        data: {
          'clientMessageId': clientMessageId,
          'content': text,
          if (quoted?['id'] != null) 'replyToMessageId': quoted!['id'],
        },
      );
      _upsert(saved);
      await _ref.read(databaseProvider).upsertMessage(saved);
    } catch (_) {
      _upsert({...optimistic, 'pending': false, 'failed': true});
    }
  }

  Future<void> remove(String id) async {
    final updated = await _api.delete<Map<String, dynamic>>('/api/v1/messages/$id');
    _upsert(updated);
    await _ref.read(databaseProvider).upsertMessage(updated);
  }

  Future<void> hide(String id) async {
    await _api.post('/api/v1/messages/$id/hide');
    _drop(id);
  }

  Future<void> hideMany(Iterable<String> ids) async {
    await _eachId(ids, hide);
  }

  Future<void> removeMany(Iterable<String> ids) async {
    await _eachId(ids, remove);
  }

  Future<void> react(String id, String emoji) async {
    await _api.post('/api/v1/messages/$id/reactions', data: {'emoji': emoji});
  }

  Future<void> forward(Map<String, dynamic> message, String targetId) async {
    if (!canForwardMessage(message)) {
      throw const ApiError(message: 'This message cannot be forwarded.', code: 'INVALID_REFERENCE');
    }
    await _api.post('/api/v1/messages/${message['id']}/forward', data: {
      'conversationId': targetId,
      'clientMessageId': const Uuid().v4(),
      'content': forwardContent(message),
    });
  }

  Future<void> forwardMany(List<Map<String, dynamic>> messages, String targetId) async {
    Object? lastError;
    for (final message in messages.where(canForwardMessage)) {
      try {
        await forward(message, targetId);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError != null) throw lastError;
  }

  Future<void> _eachId(Iterable<String> ids, Future<void> Function(String id) action) async {
    Object? lastError;
    for (final id in ids) {
      try {
        await action(id);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError != null) throw lastError;
  }

  CancelToken? _uploadCancel;

  Future<void> sendAttachment(PreparedMedia media, {String? caption}) async {
    _uploadCancel?.cancel();
    final cancel = CancelToken();
    _uploadCancel = cancel;
    state = state.copyWith(
      uploading: true,
      uploadProgress: 0,
      uploadLabel: media.compressed
          ? '${formatMediaSize(media.originalSizeBytes)} → ${formatMediaSize(media.sizeBytes)}'
          : formatMediaSize(media.sizeBytes),
      uploadOriginalSize: media.originalSizeBytes,
      uploadCompressedSize: media.sizeBytes,
      clearEta: true,
    );
    final clientMessageId = const Uuid().v4();
    final draft = {
      'id': clientMessageId,
      'clientMessageId': clientMessageId,
      'conversationId': conversationId,
      'senderId': _ref.read(authControllerProvider).user?.id,
      'content': caption ?? '',
      'messageType': media.kind,
      'createdAt': DateTime.now().toUtc().toIso8601String(),
      'pending': true,
      'transfer': {
        'path': media.path,
        'fileName': media.fileName,
        'mimeType': media.mimeType,
        'sizeBytes': media.sizeBytes,
      },
    };
    _upsert(draft);
    await _ref.read(databaseProvider).upsertMessage(draft);
    try {
      final saved = await MediaUploader(_api).upload(
        conversationId: conversationId,
        path: media.path,
        fileName: media.fileName,
        mimeType: media.mimeType,
        caption: caption,
        replyToMessageId: state.replyTo?['id'] as String?,
        clientMessageId: clientMessageId,
        cancelToken: cancel,
        onState: (transfer) async {
          await _ref.read(databaseProvider).upsertMessage({
            ...draft,
            'transfer': {...(draft['transfer'] as Map), ...transfer},
          });
        },
        onProgress: (progress) {
          state = state.copyWith(
            uploading: true,
            uploadProgress: progress.percent,
            uploadEta: progress.eta,
            uploadLabel: progress.phase == 'finalizing'
                ? 'Finishing ${formatMediaSize(progress.total)}'
                : '${formatMediaSize(progress.sent)} of ${formatMediaSize(progress.total)}',
          );
        },
      );
      state = state.copyWith(
        clearReply: true,
        uploading: false,
        uploadProgress: 0,
        uploadLabel: '',
        clearEta: true,
      );
      _upsert(saved);
      await _ref.read(databaseProvider).upsertMessage(saved);
    } catch (error) {
      state = state.copyWith(uploading: false, uploadProgress: 0, uploadLabel: '', clearEta: true);
      if (error is DioException && CancelToken.isCancel(error)) return;
      if (error is MediaLimitException && error.message.contains('cancelled')) return;
      _upsert({...draft, 'pending': false, 'failed': true});
      await _ref.read(databaseProvider).upsertMessage({...draft, 'pending': false, 'failed': true});
      rethrow;
    } finally {
      if (identical(_uploadCancel, cancel)) _uploadCancel = null;
    }
  }

  Future<void> sendAttachments(List<PreparedMedia> media, {String? caption}) async {
    if (media.isEmpty) return;
    if (media.length == 1) {
      await sendAttachment(media.first, caption: caption);
      return;
    }
    _uploadCancel?.cancel();
    final cancel = CancelToken();
    _uploadCancel = cancel;
    state = state.copyWith(
      uploading: true,
      uploadProgress: 0,
      uploadLabel: 'Uploading ${media.length} files',
      clearEta: true,
    );
    final clientMessageId = const Uuid().v4();
    final uploader = MediaUploader(_api);
    try {
      final stored = await runPool(List.generate(media.length, (index) => index), fileUploadConcurrency, (index) async {
        final item = media[index];
        return uploader.uploadToStorage(
          conversationId: conversationId,
          path: item.path,
          fileName: item.fileName,
          mimeType: item.mimeType,
          cancelToken: cancel,
          onProgress: (progress) {
            state = state.copyWith(
              uploading: true,
              uploadProgress: progress.percent,
              uploadEta: progress.eta,
              uploadLabel: 'File ${index + 1}/${media.length} · ${formatMediaSize(progress.sent)} of ${formatMediaSize(progress.total)}',
            );
          },
        );
      });
      state = state.copyWith(uploadLabel: 'Finishing ${media.length} files', uploadProgress: 100);
      final saved = await uploader.completeBatch(
        conversationId: conversationId,
        clientMessageId: clientMessageId,
        caption: caption,
        replyToMessageId: state.replyTo?['id'] as String?,
        items: stored
            .map((row) {
              final parts = (row['parts'] as List?) ?? const [];
              return {
                'id': row['id'],
                if (parts.isNotEmpty)
                  'parts': parts
                      .map((part) => {
                            'partNumber': (part as Map)['partNumber'],
                            'etag': part['etag'],
                          })
                      .toList(),
              };
            })
            .toList(),
        cancelToken: cancel,
      );
      state = state.copyWith(
        clearReply: true,
        uploading: false,
        uploadProgress: 0,
        uploadLabel: '',
        clearEta: true,
      );
      _upsert(saved);
      await _ref.read(databaseProvider).upsertMessage(saved);
    } catch (error) {
      state = state.copyWith(uploading: false, uploadProgress: 0, uploadLabel: '', clearEta: true);
      if (error is DioException && CancelToken.isCancel(error)) return;
      if (error is MediaLimitException && error.message.contains('cancelled')) return;
      rethrow;
    } finally {
      if (identical(_uploadCancel, cancel)) _uploadCancel = null;
    }
  }

  void cancelUpload() {
    _uploadCancel?.cancel('cancelled');
  }

  Future<void> _resumePending(List<Map<String, dynamic>> messages) async {
    for (final row in messages) {
      final transfer = row['transfer'];
      if (row['pending'] != true || transfer is! Map) continue;
      final path = transfer['path'] as String?;
      if (path == null || !File(path).existsSync()) continue;
      final cancel = CancelToken();
      _uploadCancel = cancel;
      state = state.copyWith(uploading: true, uploadLabel: 'Resuming upload');
      try {
        final saved = await MediaUploader(_api).upload(
          conversationId: conversationId,
          path: path,
          fileName: transfer['fileName'] as String? ?? 'file',
          mimeType: transfer['mimeType'] as String? ?? 'application/octet-stream',
          caption: row['content'] as String?,
          clientMessageId: row['clientMessageId'] as String?,
          attachmentId: transfer['attachmentId'] as String?,
          completedParts: ((transfer['parts'] as List?) ?? []).whereType<Map>().map(Map<String, dynamic>.from).toList(),
          cancelToken: cancel,
        );
        _upsert(saved);
        await _ref.read(databaseProvider).upsertMessage(saved);
      } catch (_) {
        _upsert({...row, 'pending': false, 'failed': true});
      } finally {
        state = state.copyWith(uploading: false, uploadProgress: 0, uploadLabel: '', clearEta: true);
      }
    }
  }

  Future<void> loadOlder() async {
    if (state.loadingOlder || !state.hasOlder) return;
    final minSeq = _minSeq(state.messages);
    if (minSeq <= 1) {
      state = state.copyWith(hasOlder: false);
      return;
    }
    state = state.copyWith(loadingOlder: true);
    try {
      final afterSeq = minSeq > 81 ? minSeq - 81 : 0;
      final page = await _api.get<Map<String, dynamic>>(
        '/api/v1/conversations/$conversationId/messages',
        query: {'afterSeq': afterSeq, 'limit': 80},
      );
      final incoming = ((page['data'] as List?) ?? []).cast<Map>().map(Map<String, dynamic>.from);
      final merged = _live(_merge(state.messages, incoming));
      state = state.copyWith(
        messages: _sort(merged),
        loadingOlder: false,
        hasOlder: _minSeq(merged) > 1,
      );
      await _ref.read(databaseProvider).replaceConversation(conversationId, merged);
    } catch (_) {
      state = state.copyWith(loadingOlder: false);
    }
  }

  void setReply(Map<String, dynamic>? message) => state = state.copyWith(replyTo: message, clearReply: message == null);
  void setEditing(Map<String, dynamic>? message) =>
      state = state.copyWith(editing: message, clearEditing: message == null);

  void typing(bool start) {
    _ref.read(chatSocketProvider).send(start ? 'typing.start' : 'typing.stop', {
      'conversationId': conversationId,
    });
  }

  void _onEvent(Map<String, dynamic> event) {
    final name = event['event'] as String? ?? '';
    final data = (event['data'] as Map?)?.cast<String, dynamic>() ?? {};
    if (data['conversationId'] != conversationId && name.startsWith('message.')) return;
    if (name == 'message.expired' || name == 'message.hidden') {
      final id = data['id'] as String?;
      if (id == null) return;
      state = state.copyWith(messages: state.messages.where((row) => row['id'] != id).toList());
      _ref.read(databaseProvider).deleteMessage(id);
      return;
    }
    if (name == 'notification.created') {
      load();
    }
    if (name == 'message.created' || name == 'message.updated' || name == 'message.deleted') {
      if (data['expiredAt'] != null) {
        final id = data['id'] as String?;
        if (id != null) {
          state = state.copyWith(messages: state.messages.where((row) => row['id'] != id).toList());
          _ref.read(databaseProvider).deleteMessage(id);
        }
        return;
      }
      _upsert(data);
      _ref.read(databaseProvider).upsertMessage(data);
      if (name == 'message.created' && data['id'] is String) {
        _ref.read(chatSocketProvider).send('message.delivered', {'messageId': data['id']});
      }
      _markRead();
    }
    if (name == 'receipt.updated') {
      final userId = data['userId'];
      final seq = (data['sequenceNumber'] as num?)?.toInt();
      if (userId != null && seq != null && state.details != null) {
        final members = ((state.details!['members'] as List?) ?? []).map((row) {
          if (row is Map && row['id'] == userId) {
            return {...Map<String, dynamic>.from(row), 'lastReadSeq': seq};
          }
          return row;
        }).toList();
        state = state.copyWith(details: {...state.details!, 'members': members});
      }
      loadReceipts();
    }
    if (name == 'connection.ready') load();
    if (name == 'conversation.updated' || name.startsWith('group.')) {
      final id = data['id'] ?? data['conversationId'];
      if (id == conversationId) _reloadDetails();
    }
  }

  Future<void> _reloadDetails() async {
    try {
      final details = await _api.get<Map<String, dynamic>>('/api/v1/conversations/$conversationId');
      state = state.copyWith(details: details);
    } catch (error) {
      if (error is ApiError && (error.status == 403 || error.status == 404)) {
        state = state.copyWith(details: {'id': conversationId, 'removed': true, 'type': 'group'});
      }
    }
  }

  Future<void> loadReceipts() async {
    try {
      final receipts = await _api.get<dynamic>('/api/v1/conversations/$conversationId/receipts');
      final receiptRows = receipts is List
          ? receipts.cast<Map>().map(Map<String, dynamic>.from).toList()
          : ((receipts as Map?)?['data'] as List? ?? []).cast<Map>().map(Map<String, dynamic>.from).toList();
      state = state.copyWith(receipts: receiptRows);
    } catch (_) {}
  }

  void _markRead() {
    final numbered = state.messages.where((row) => row['sequenceNumber'] is int).toList();
    if (numbered.isEmpty) return;
    final newest = numbered.map((row) => row['sequenceNumber'] as int).fold<int>(0, (a, b) => a > b ? a : b);
    _api.post('/api/v1/conversations/$conversationId/read', data: {'sequenceNumber': newest});
    _ref.read(chatSocketProvider).send('conversation.read', {
      'conversationId': conversationId,
      'sequenceNumber': newest,
    });
  }

  void _drop(String id) {
    state = state.copyWith(messages: state.messages.where((row) => row['id'] != id).toList());
    _ref.read(databaseProvider).deleteMessage(id);
  }

  void _upsert(Map<String, dynamic> incoming) {
    state = state.copyWith(messages: _sort(upsertLogicalMessage(state.messages, incoming)));
  }

  List<Map<String, dynamic>> _live(Iterable<Map<String, dynamic>> rows) {
    return rows.where((row) => !cachedPayloadExpired(row)).toList();
  }

  int _minSeq(List<Map<String, dynamic>> rows) {
    var min = 1 << 30;
    var found = false;
    for (final row in rows) {
      final seq = (row['sequenceNumber'] as num?)?.toInt() ?? 0;
      if (seq <= 0) continue;
      found = true;
      if (seq < min) min = seq;
    }
    return found ? min : 0;
  }

  List<Map<String, dynamic>> _sort(List<Map<String, dynamic>> rows) {
    final next = [...rows];
    next.sort((a, b) {
      final seq = (a['sequenceNumber'] as num? ?? 0).compareTo(b['sequenceNumber'] as num? ?? 0);
      if (seq != 0) return seq;
      return (a['createdAt'] ?? '').toString().compareTo((b['createdAt'] ?? '').toString());
    });
    return next;
  }

  List<Map<String, dynamic>> _merge(
    List<Map<String, dynamic>> current,
    Iterable<Map<String, dynamic>> incoming,
  ) {
    var next = collapseDuplicateMessages(current);
    for (final item in incoming) {
      next = upsertLogicalMessage(next, item);
    }
    return _sort(next);
  }

  @override
  void dispose() {
    _userSub?.close();
    _sub?.cancel();
    super.dispose();
  }
}

final messagesControllerProvider =
    StateNotifierProvider.family<MessagesController, MessagesState, String>((ref, id) {
  return MessagesController(ref, id);
});
