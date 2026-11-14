import 'dart:io';

import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:company_chat/features/media/media_prepare.dart';
import 'package:company_chat/features/media/media_upload.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

class RecordingClient extends ApiClient {
  RecordingClient(super.store, {super.client, this.onPut});

  final List<String> posts = [];
  final List<String> deletes = [];
  final Future<String?> Function()? onPut;
  int puts = 0;

  @override
  Future<T> post<T>(String path, {Object? data}) async {
    posts.add(path);
    if (path.contains('/attachments') && path.endsWith('/attachments')) {
      return {
        'id': 'att-1',
        'mode': 'single',
        'uploadUrl': 'https://storage.test/put',
        'headers': {'Content-Type': 'image/png'},
      } as T;
    }
    if (path.endsWith('/finalize')) {
      return {
        'id': 'msg-1',
        'messageType': 'image',
        'attachment': {'id': 'att-1', 'status': 'available', 'kind': 'image'},
      } as T;
    }
    throw StateError('unexpected POST $path');
  }

  @override
  Future<T> delete<T>(String path, {Object? data}) async {
    deletes.add(path);
    return {'success': true} as T;
  }

  @override
  Future<String?> putFileRange(
    String url,
    File? file, {
    List<int>? bytes,
    required int start,
    required int end,
    Map<String, String>? headers,
    void Function(int sent, int total)? onProgress,
    CancelToken? cancelToken,
  }) async {
    puts += 1;
    if (cancelToken?.isCancelled == true) {
      throw DioException(requestOptions: RequestOptions(path: url), type: DioExceptionType.cancel);
    }
    onProgress?.call(end - start, end - start);
    if (onPut != null) return onPut!();
    return '"etag-1"';
  }
}

void main() {
  late File file;

  setUp(() async {
    file = File('${Directory.systemTemp.path}/michat-phase5-pixel.png');
    await file.writeAsBytes(List<int>.filled(8, 7));
  });

  tearDown(() async {
    if (await file.exists()) await file.delete();
  });

  RecordingClient client() {
    final store = SessionStore.memory();
    return RecordingClient(store, client: Dio(BaseOptions(baseUrl: 'https://api.michat.in')));
  }

  test('uploads through init, presigned PUT and finalize', () async {
    final api = client();
    final progress = <MediaUploadProgress>[];
    final result = await MediaUploader(api).upload(
      conversationId: 'conv-1',
      path: file.path,
      fileName: 'pixel.png',
      mimeType: 'image/png',
      onProgress: progress.add,
    );
    expect(result['messageType'], 'image');
    expect(result['attachment']?['id'], 'att-1');
    expect(api.posts.any((path) => path.endsWith('/conversations/conv-1/attachments')), isTrue);
    expect(api.posts.any((path) => path.endsWith('/attachments/att-1/finalize')), isTrue);
    expect(api.puts, 1);
    expect(progress.any((item) => item.percent > 0), isTrue);
    expect(result.toString().contains('storage.test/put'), isFalse);
  });

  test('retries a failed PUT then finalizes', () async {
    var attempts = 0;
    final store = SessionStore.memory();
    final api = RecordingClient(
      store,
      client: Dio(BaseOptions(baseUrl: 'https://api.michat.in')),
      onPut: () async {
        attempts += 1;
        if (attempts == 1) {
          throw const ApiError(message: 'Upload failed', status: 500);
        }
        return '"etag-2"';
      },
    );
    final result = await MediaUploader(api).upload(
      conversationId: 'conv-1',
      path: file.path,
      fileName: 'pixel.png',
      mimeType: 'image/png',
    );
    expect(result['id'], 'msg-1');
    expect(attempts, 2);
  });

  test('cancel deletes the pending attachment', () async {
    final api = client();
    final token = CancelToken();
    token.cancel('stop');
    await expectLater(
      MediaUploader(api).upload(
        conversationId: 'conv-1',
        path: file.path,
        fileName: 'pixel.png',
        mimeType: 'image/png',
        cancelToken: token,
      ),
      throwsA(isA<MediaLimitException>()),
    );
    expect(api.deletes, ['/api/v1/attachments/att-1']);
    expect(api.posts.any((path) => path.endsWith('/finalize')), isFalse);
  });
}
