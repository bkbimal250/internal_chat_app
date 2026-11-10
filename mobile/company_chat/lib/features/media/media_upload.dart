import 'dart:io';

import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/features/media/media_limits.dart';
import 'package:company_chat/features/media/media_prepare.dart';
import 'package:company_chat/features/media/transfer_runtime.dart';
import 'package:dio/dio.dart';

class MediaUploadProgress {
  const MediaUploadProgress({
    required this.phase,
    required this.sent,
    required this.total,
    this.eta,
  });

  final String phase;
  final int sent;
  final int total;
  final Duration? eta;

  int get percent => total <= 0 ? 0 : ((sent / total) * 100).round().clamp(0, 100);
}

class MediaUploader {
  MediaUploader(this._api);

  final ApiClient _api;

  Future<Map<String, dynamic>> uploadToStorage({
    required String conversationId,
    required String path,
    required String fileName,
    required String mimeType,
    String? attachmentId,
    List<Map<String, dynamic>> completedParts = const [],
    CancelToken? cancelToken,
    void Function(MediaUploadProgress progress)? onProgress,
    void Function(Map<String, dynamic> state)? onState,
    bool abortOnCancel = true,
  }) async {
    final file = File(path);
    if (!await file.exists()) {
      throw const MediaLimitException('Original file is no longer available to resume.');
    }
    final size = await file.length();
    final started = DateTime.now();
    void emit(String phase, int sent) {
      final elapsed = DateTime.now().difference(started).inMilliseconds;
      final rate = elapsed > 0 ? sent / (elapsed / 1000) : 0;
      final eta = rate > 0 && sent < size ? Duration(seconds: ((size - sent) / rate).round()) : null;
      onProgress?.call(MediaUploadProgress(phase: phase, sent: sent, total: size, eta: eta));
    }

    emit('starting', 0);
    var init = attachmentId == null
        ? await _api.post<Map<String, dynamic>>(
            '/api/v1/conversations/$conversationId/attachments',
            data: {
              'fileName': fileName,
              'mimeType': mimeType,
              'sizeBytes': size,
              if (size > singlePutMaxBytes) 'strategy': 'multipart',
            },
          )
        : {'id': attachmentId, 'mode': size > singlePutMaxBytes ? 'multipart' : 'single'};
    onState?.call({'attachmentId': init['id'], 'phase': 'uploading'});
    try {
      final parts = <Map<String, dynamic>>[
        ...completedParts.map((part) => {'partNumber': part['partNumber'], 'etag': part['etag']}),
      ];
      if (init['mode'] == 'multipart' || size > singlePutMaxBytes) {
        final listed = await _api.get<Map<String, dynamic>>('/api/v1/attachments/${init['id']}/parts');
        for (final part in (listed['parts'] as List? ?? [])) {
          final row = Map<String, dynamic>.from(part as Map);
          if (row['partNumber'] != null && row['etag'] != null) {
            parts.removeWhere((item) => item['partNumber'] == row['partNumber']);
            parts.add({'partNumber': row['partNumber'], 'etag': row['etag']});
          }
        }
        final partCount = (init['partCount'] as num?)?.toInt() ?? (size / multipartPartSize).ceil();
        final pending = missingPartNumbers(
          partCount,
          parts.map((part) => (part['partNumber'] as num).toInt()),
        );
        emit('uploading', parts.length * multipartPartSize);
        await runPool(pending, multipartConcurrency, (partNumber) async {
          if (cancelToken?.isCancelled == true) throw const MediaLimitException('Upload cancelled');
          final start = (partNumber - 1) * multipartPartSize;
          final end = start + multipartPartSize > size ? size : start + multipartPartSize;
          final etag = await _putPart(
            init['id'] as String,
            file,
            partNumber: partNumber,
            start: start,
            end: end,
            cancelToken: cancelToken,
            onProgress: (sent) => emit('uploading', start + sent),
          );
          parts.removeWhere((item) => item['partNumber'] == partNumber);
          parts.add({'partNumber': partNumber, 'etag': etag});
          onState?.call({
            'attachmentId': init['id'],
            'parts': [...parts],
          });
          emit('uploading', end);
          return partNumber;
        });
      } else {
        await _putWithRetry(
          () => _api.putFileRange(
            init['uploadUrl'] as String,
            file,
            start: 0,
            end: size,
            headers: (init['headers'] as Map?)?.map((key, value) => MapEntry(key.toString(), value.toString())),
            cancelToken: cancelToken,
            onProgress: (sent, _) => emit('uploading', sent),
          ),
          cancelToken,
        );
      }
      emit('uploaded', size);
      return {
        'id': init['id'],
        'parts': parts,
      };
    } catch (error) {
      if (abortOnCancel && _isCancel(error) && init['id'] != null) {
        try {
          await _api.delete('/api/v1/attachments/${init['id']}');
        } catch (_) {}
      }
      rethrow;
    }
  }

  Future<Map<String, dynamic>> completeBatch({
    required String conversationId,
    required List<Map<String, dynamic>> items,
    String? caption,
    String? replyToMessageId,
    String? clientMessageId,
    CancelToken? cancelToken,
  }) {
    return _postWithRetry(
      '/api/v1/conversations/$conversationId/attachments/complete',
      {
        'clientMessageId': ?clientMessageId,
        if (caption != null && caption.trim().isNotEmpty) 'caption': caption.trim(),
        'replyToMessageId': ?replyToMessageId,
        'items': items,
      },
      cancelToken,
    );
  }

  Future<Map<String, dynamic>> upload({
    required String conversationId,
    required String path,
    required String fileName,
    required String mimeType,
    String? caption,
    String? replyToMessageId,
    String? clientMessageId,
    String? attachmentId,
    List<Map<String, dynamic>> completedParts = const [],
    CancelToken? cancelToken,
    void Function(MediaUploadProgress progress)? onProgress,
    void Function(Map<String, dynamic> state)? onState,
  }) async {
    final stored = await uploadToStorage(
      conversationId: conversationId,
      path: path,
      fileName: fileName,
      mimeType: mimeType,
      attachmentId: attachmentId,
      completedParts: completedParts,
      cancelToken: cancelToken,
      onProgress: onProgress,
      onState: (state) => onState?.call({...state, 'clientMessageId': clientMessageId}),
    );
    onProgress?.call(MediaUploadProgress(phase: 'finalizing', sent: 1, total: 1));
    return _finalize(
      stored['id'] as String,
      {
        'clientMessageId': ?clientMessageId,
        if (caption != null && caption.trim().isNotEmpty) 'caption': caption.trim(),
        'replyToMessageId': ?replyToMessageId,
        if ((stored['parts'] as List).isNotEmpty)
          'parts': (stored['parts'] as List)
              .map((part) => {'partNumber': (part as Map)['partNumber'], 'etag': part['etag']})
              .toList(),
      },
      cancelToken,
    );
  }

  Future<String> _putPart(
    String attachmentId,
    File file, {
    required int partNumber,
    required int start,
    required int end,
    CancelToken? cancelToken,
    void Function(int sent)? onProgress,
  }) async {
    return _putWithRetry(() async {
      final signed = await _api.post<Map<String, dynamic>>(
        '/api/v1/attachments/$attachmentId/parts',
        data: {
          'partNumbers': [partNumber],
        },
      );
      final part = ((signed['parts'] as List?)?.first as Map?)?.cast<String, dynamic>();
      if (part == null) throw const MediaLimitException('Upload failed');
      final etag = await _api.putFileRange(
        part['uploadUrl'] as String,
        file,
        start: start,
        end: end,
        headers: (part['headers'] as Map?)?.map((key, value) => MapEntry(key.toString(), value.toString())),
        cancelToken: cancelToken,
        onProgress: (sent, _) => onProgress?.call(sent),
      );
      if (etag == null || etag.isEmpty) throw const MediaLimitException('Upload failed');
      return etag;
    }, cancelToken);
  }

  Future<T> _putWithRetry<T>(Future<T> Function() send, CancelToken? cancelToken) async {
    Object? lastError;
    for (var attempt = 0; attempt < 4; attempt += 1) {
      if (cancelToken?.isCancelled == true) throw const MediaLimitException('Upload cancelled');
      try {
        return await send();
      } catch (error) {
        lastError = error;
        if (_isCancel(error)) rethrow;
        await Future<void>.delayed(retryDelay(attempt));
      }
    }
    throw lastError ?? const MediaLimitException('Upload failed');
  }

  Future<Map<String, dynamic>> _finalize(String id, Map<String, dynamic> body, CancelToken? cancelToken) {
    return _postWithRetry('/api/v1/attachments/$id/finalize', body, cancelToken);
  }

  Future<Map<String, dynamic>> _postWithRetry(String path, Map<String, dynamic> body, CancelToken? cancelToken) async {
    Object? lastError;
    for (var attempt = 0; attempt < 4; attempt += 1) {
      if (cancelToken?.isCancelled == true) throw const MediaLimitException('Upload cancelled');
      try {
        return await _api.post<Map<String, dynamic>>(path, data: body);
      } catch (error) {
        lastError = error;
        final status = error is ApiError ? error.status : null;
        if (status == 409 || status == null || status >= 500) {
          await Future<void>.delayed(retryDelay(attempt, baseMs: 600));
          continue;
        }
        rethrow;
      }
    }
    throw lastError ?? const MediaLimitException('Upload failed');
  }

  bool _isCancel(Object error) {
    return error is DioException && CancelToken.isCancel(error) ||
        (error is MediaLimitException && error.message.contains('cancelled'));
  }
}
