import 'dart:io';

import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/features/media/media_limits.dart';
import 'package:company_chat/features/media/media_prepare.dart';
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

  Future<Map<String, dynamic>> upload({
    required String conversationId,
    required String path,
    required String fileName,
    required String mimeType,
    String? caption,
    String? replyToMessageId,
    String? clientMessageId,
    CancelToken? cancelToken,
    void Function(MediaUploadProgress progress)? onProgress,
  }) async {
    final file = File(path);
    final size = await file.length();
    final started = DateTime.now();
    void emit(String phase, int sent) {
      final elapsed = DateTime.now().difference(started).inMilliseconds;
      final rate = elapsed > 0 ? sent / (elapsed / 1000) : 0;
      final eta = rate > 0 && sent < size ? Duration(seconds: ((size - sent) / rate).round()) : null;
      onProgress?.call(MediaUploadProgress(phase: phase, sent: sent, total: size, eta: eta));
    }

    emit('starting', 0);
    final init = await _api.post<Map<String, dynamic>>(
      '/api/v1/conversations/$conversationId/attachments',
      data: {
        'fileName': fileName,
        'mimeType': mimeType,
        'sizeBytes': size,
        if (size > singlePutMaxBytes) 'strategy': 'multipart',
      },
    );
    try {
      final parts = <Map<String, String>>[];
      if (init['mode'] == 'multipart') {
        final partCount = (init['partCount'] as num?)?.toInt() ?? (size / multipartPartSize).ceil();
        for (var index = 0; index < partCount; index += 1) {
          if (cancelToken?.isCancelled == true) throw const MediaLimitException('Upload cancelled');
          final partNumber = index + 1;
          final start = index * multipartPartSize;
          final end = start + multipartPartSize > size ? size : start + multipartPartSize;
          final signed = await _api.post<Map<String, dynamic>>(
            '/api/v1/attachments/${init['id']}/parts',
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
            onProgress: (sent, _) => emit('uploading', start + sent),
          );
          if (etag == null || etag.isEmpty) throw const MediaLimitException('Upload failed');
          parts.add({'partNumber': '$partNumber', 'etag': etag});
          emit('uploading', end);
        }
      } else {
        await _api.putFileRange(
          init['uploadUrl'] as String,
          file,
          start: 0,
          end: size,
          headers: (init['headers'] as Map?)?.map((key, value) => MapEntry(key.toString(), value.toString())),
          cancelToken: cancelToken,
          onProgress: (sent, _) => emit('uploading', sent),
        );
      }
      emit('finalizing', size);
      return await _api.post<Map<String, dynamic>>(
        '/api/v1/attachments/${init['id']}/finalize',
        data: {
          'clientMessageId': ?clientMessageId,
          if (caption != null && caption.trim().isNotEmpty) 'caption': caption.trim(),
          'replyToMessageId': ?replyToMessageId,
          if (parts.isNotEmpty)
            'parts': parts
                .map((part) => {'partNumber': int.parse(part['partNumber']!), 'etag': part['etag']})
                .toList(),
        },
      );
    } catch (error) {
      try {
        await _api.delete('/api/v1/attachments/${init['id']}');
      } catch (_) {}
      rethrow;
    }
  }
}
