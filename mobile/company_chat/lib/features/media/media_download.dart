import 'dart:io';

import 'package:company_chat/core/network/api_client.dart';
import 'package:dio/dio.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class MediaDownloadException implements Exception {
  const MediaDownloadException(this.message);
  final String message;
  @override
  String toString() => message;
}

Future<File> downloadAttachmentFile({
  required ApiClient api,
  required String attachmentId,
  required String fileName,
  int? sizeBytes,
  CancelToken? cancelToken,
  void Function(int sent, int total)? onProgress,
}) async {
  final data = await api.get<Map<String, dynamic>>(
    '/api/v1/attachments/$attachmentId/url',
    query: {'download': true},
  );
  final url = data['url'] as String?;
  if (url == null || url.isEmpty) throw const MediaDownloadException('Download unavailable');
  final dir = Directory(p.join((await getTemporaryDirectory()).path, 'company-chat-downloads'));
  await dir.create(recursive: true);
  final safeName = fileName.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
  final target = File(p.join(dir.path, safeName));
  if (await target.exists() && sizeBytes != null && await target.length() == sizeBytes) {
    return target;
  }
  final part = File('${target.path}.part');
  final start = await part.exists() ? await part.length() : 0;
  if (sizeBytes != null && start > sizeBytes) {
    await part.delete();
  }
  final resumeFrom = await part.exists() ? await part.length() : 0;
  final client = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(minutes: 30),
    ),
  );
  final headers = <String, dynamic>{};
  if (resumeFrom > 0) headers['Range'] = 'bytes=$resumeFrom-';
  final response = await client.get<ResponseBody>(
    url,
    options: Options(headers: headers, responseType: ResponseType.stream),
    cancelToken: cancelToken,
  );
  final status = response.statusCode ?? 0;
  if (resumeFrom > 0 && status != 206) {
    if (await part.exists()) await part.delete();
  }
  final sink = part.openWrite(mode: resumeFrom > 0 && status == 206 ? FileMode.append : FileMode.write);
  var received = resumeFrom > 0 && status == 206 ? resumeFrom : 0;
  try {
    await for (final chunk in response.data!.stream) {
      sink.add(chunk);
      received += chunk.length;
      onProgress?.call(received, sizeBytes ?? received);
    }
  } finally {
    await sink.close();
  }
  if (sizeBytes != null && received != sizeBytes) {
    throw const MediaDownloadException('Download incomplete');
  }
  if (await target.exists()) await target.delete();
  await part.rename(target.path);
  return target;
}
