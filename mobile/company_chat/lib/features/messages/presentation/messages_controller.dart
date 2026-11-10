import 'dart:async';
import 'dart:io';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/media/media_limits.dart';
import 'package:company_chat/features/media/media_prepare.dart';
import 'package:company_chat/features/media/media_upload.dart';
import 'package:company_chat/features/media/transfer_runtime.dart';
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
    );
  }
}

class MessagesController extends StateNotifier<MessagesState> {
  MessagesController(this._ref, this.conversationId) : super(const MessagesState()) {
    _sub = _ref.read(chatSocketProvider).events.listen(_onEvent);
    load();
  }

  final Ref _ref;
  final String conversationId;
  StreamSubscription<Map<String, dynamic>>? _sub;
  ApiClient get _api => _ref.read(apiClientProvider);

  Future<void> load() async {
    try {
      await _ref.read(databaseProvider).dropExpired();
      final cached = _live(await _ref.read(databaseProvider).loadMessages(conversationId));
      if (cached.isNotEmpty) {
        state = state.copyWith(messages: _sort(cached), loading: false);
      }
      final details = await _api.get<Map<String, dynamic>>('/api/v1/conversations/$conversationId');
      final afterSeq = cached.isEmpty
          ? 0
          : cached.map((row) => row['sequenceNumber'] as int? ?? 0).fold<int>(0, (a, b) => a > b ? a : b);
      final page = await _api.get<Map<String, dynamic>>(
        '/api/v1/conversations/$conversationId/messages',
        query: {'afterSeq': afterSeq > 0 ? afterSeq : 0, 'limit': 80},
      );
      var messages = _live(_merge(cached, ((page['data'] as List?) ?? []).cast<Map>().map(Map<String, dynamic>.from)));
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
      final withDrafts = _live(await _ref.read(databaseProvider).loadMessages(conversationId));
      state = state.copyWith(
        details: details,
        retention: retention,
        messages: _sort(withDrafts),
        receipts: receiptRows,
        loading: false,
      );
      _markRead();
      unawaited(_resumePending(withDrafts));
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
    await _api.delete('/api/v1/messages/$id');
  }

  Future<void> hide(String id) async {
    await _api.post('/api/v1/messages/$id/hide');
    state = state.copyWith(messages: state.messages.where((row) => row['id'] != id).toList());
  }

  Future<void> react(String id, String emoji) async {
    await _api.post('/api/v1/messages/$id/reactions', data: {'emoji': emoji});
  }

  Future<void> forward(String id, String targetId) async {
    await _api.post('/api/v1/messages/$id/forward', data: {
      'conversationId': targetId,
      'clientMessageId': const Uuid().v4(),
    });
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

  void _upsert(Map<String, dynamic> incoming) {
    final next = [...state.messages];
    final index = next.indexWhere((row) {
      return row['id'] == incoming['id'] ||
          (incoming['clientMessageId'] != null && row['clientMessageId'] == incoming['clientMessageId']);
    });
    if (index == -1) {
      next.add(incoming);
    } else {
      next[index] = {...next[index], ...incoming, 'pending': incoming['pending'] ?? false};
    }
    state = state.copyWith(messages: _sort(next));
  }

  List<Map<String, dynamic>> _live(Iterable<Map<String, dynamic>> rows) {
    return rows.where((row) => row['expiredAt'] == null).toList();
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
    var next = [...current];
    for (final item in incoming) {
      final index = next.indexWhere((row) => row['id'] == item['id'] || row['clientMessageId'] == item['clientMessageId']);
      if (index == -1) {
        next.add(item);
      } else {
        next[index] = {...next[index], ...item};
      }
    }
    return _sort(next);
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

final messagesControllerProvider =
    StateNotifierProvider.family<MessagesController, MessagesState, String>((ref, id) {
  return MessagesController(ref, id);
});
