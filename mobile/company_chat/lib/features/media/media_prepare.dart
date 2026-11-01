import 'dart:io';
import 'dart:typed_data';

import 'package:company_chat/features/media/media_limits.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:video_compress/video_compress.dart';

class MediaLimitException implements Exception {
  const MediaLimitException(this.message);
  final String message;

  @override
  String toString() => message;
}

class PreparedMedia {
  const PreparedMedia({
    required this.fileName,
    required this.mimeType,
    required this.path,
    required this.sizeBytes,
    required this.originalSizeBytes,
    required this.kind,
    this.compressed = false,
  });

  final String fileName;
  final String mimeType;
  final String path;
  final int sizeBytes;
  final int originalSizeBytes;
  final String kind;
  final bool compressed;
}

String mimeFromName(String name, [String? fallback]) {
  final ext = p.extension(name).toLowerCase();
  return switch (ext) {
    '.jpg' || '.jpeg' => 'image/jpeg',
    '.png' => 'image/png',
    '.webp' => 'image/webp',
    '.gif' => 'image/gif',
    '.mp4' => 'video/mp4',
    '.webm' => 'video/webm',
    '.mov' => 'video/quicktime',
    '.mp3' => 'audio/mpeg',
    '.m4a' || '.aac' => 'audio/mp4',
    '.ogg' || '.opus' => 'audio/ogg',
    '.wav' => 'audio/wav',
    '.amr' => 'audio/amr',
    '.3gp' => 'video/3gpp',
    '.heic' || '.heif' => 'image/heic',
    '.pdf' => 'application/pdf',
    '.zip' => 'application/zip',
    '.docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt' => 'text/plain',
    _ => fallback ?? '',
  };
}

PreparedMedia assertAllowed({
  required String fileName,
  required String mimeType,
  required String path,
  required int sizeBytes,
  required int originalSizeBytes,
  bool compressed = false,
}) {
  final spec = allowedTypes[mimeType];
  if (spec == null) {
    throw const MediaLimitException('This file type is not allowed.');
  }
  if (sizeBytes < 1 || sizeBytes > spec.maxBytes) {
    throw MediaLimitException('This ${spec.kind} is still too large. Maximum is ${formatMediaSize(spec.maxBytes)}.');
  }
  return PreparedMedia(
    fileName: fileName,
    mimeType: mimeType,
    path: path,
    sizeBytes: sizeBytes,
    originalSizeBytes: originalSizeBytes,
    kind: spec.kind,
    compressed: compressed,
  );
}

Future<String> _tempPath(String name) async {
  final dir = await getTemporaryDirectory();
  return p.join(dir.path, 'cc-${DateTime.now().millisecondsSinceEpoch}-$name');
}

Future<PreparedMedia> prepareImage({
  required String path,
  required String fileName,
  String? mimeType,
  MediaQuality quality = MediaQuality.auto,
}) async {
  final original = await File(path).length();
  var name = fileName;
  var mime = mimeFromName(name, mimeType);
  final heic = mime == 'image/heic' || mime == 'image/heif' || mime == 'image/heic-sequence';
  if (!heic && (quality == MediaQuality.original || mime == 'image/gif' || original < 350 * 1024)) {
    return assertAllowed(
      fileName: name,
      mimeType: mime,
      path: path,
      sizeBytes: original,
      originalSizeBytes: original,
    );
  }
  final edge = quality == MediaQuality.high
      ? 2048
      : quality == MediaQuality.dataSaver
          ? 1280
          : 1600;
  final jpegQuality = quality == MediaQuality.high
      ? 82
      : quality == MediaQuality.dataSaver
          ? 52
          : original > 6 * 1024 * 1024
              ? 55
              : 72;
  final target = await _tempPath('${p.basenameWithoutExtension(name)}.jpg');
  final out = await FlutterImageCompress.compressAndGetFile(
    path,
    target,
    quality: jpegQuality,
    minWidth: edge,
    minHeight: edge,
    format: CompressFormat.jpeg,
  );
  if (out == null) {
    if (heic) throw const MediaLimitException('Could not convert this camera photo. Try sending a JPEG.');
    return assertAllowed(
      fileName: name,
      mimeType: mime,
      path: path,
      sizeBytes: original,
      originalSizeBytes: original,
    );
  }
  final size = await File(out.path).length();
  if (!heic && size >= (original * 0.92).floor()) {
    return assertAllowed(
      fileName: name,
      mimeType: mime,
      path: path,
      sizeBytes: original,
      originalSizeBytes: original,
    );
  }
  name = '${p.basenameWithoutExtension(name)}.jpg';
  return assertAllowed(
    fileName: name,
    mimeType: 'image/jpeg',
    path: out.path,
    sizeBytes: size,
    originalSizeBytes: original,
    compressed: true,
  );
}

Future<PreparedMedia> prepareVideo({
  required String path,
  required String fileName,
  MediaQuality quality = MediaQuality.auto,
  void Function(double progress)? onProgress,
}) async {
  final original = await File(path).length();
  var name = fileName;
  var mime = mimeFromName(name, 'video/mp4');
  if (quality == MediaQuality.original || original < 2 * 1024 * 1024) {
    return assertAllowed(
      fileName: name,
      mimeType: mime,
      path: path,
      sizeBytes: original,
      originalSizeBytes: original,
    );
  }
  MediaInfo? info;
  try {
    info = await VideoCompress.getMediaInfo(path);
  } catch (_) {}
  var preset = VideoQuality.MediumQuality;
  if (quality == MediaQuality.dataSaver) {
    preset = VideoQuality.LowQuality;
  } else if (quality == MediaQuality.high) {
    preset = VideoQuality.HighestQuality;
  } else {
    final width = info?.width ?? 0;
    final durationMs = info?.duration ?? 0;
    final bitrate = durationMs > 0 ? (original * 8) / (durationMs / 1000) : 0;
    if (width >= 1920 || original > 80 * 1024 * 1024) {
      preset = VideoQuality.LowQuality;
    } else if (width >= 1280 || original > 20 * 1024 * 1024) {
      preset = VideoQuality.MediumQuality;
    } else if (bitrate > 0 && bitrate < 1.2 * 1024 * 1024) {
      return assertAllowed(
        fileName: name,
        mimeType: mime,
        path: path,
        sizeBytes: original,
        originalSizeBytes: original,
      );
    }
  }
  final sub = VideoCompress.compressProgress$.subscribe((value) => onProgress?.call(value));
  try {
    final result = await VideoCompress.compressVideo(
      path,
      quality: preset,
      deleteOrigin: false,
      includeAudio: true,
    );
    final out = result?.file;
    if (out == null) {
      return assertAllowed(
        fileName: name,
        mimeType: mime,
        path: path,
        sizeBytes: original,
        originalSizeBytes: original,
      );
    }
    final size = await out.length();
    if (size < 1 || size >= (original * 0.92).floor()) {
      return assertAllowed(
        fileName: name,
        mimeType: mime,
        path: path,
        sizeBytes: original,
        originalSizeBytes: original,
      );
    }
    return assertAllowed(
      fileName: '${p.basenameWithoutExtension(name)}.mp4',
      mimeType: 'video/mp4',
      path: out.path,
      sizeBytes: size,
      originalSizeBytes: original,
      compressed: true,
    );
  } finally {
    sub.unsubscribe();
  }
}

Future<PreparedMedia> prepareFile({
  required String fileName,
  String? mimeType,
  String? path,
  Uint8List? bytes,
}) async {
  if (path == null && bytes == null) {
    throw const MediaLimitException('Could not read that file.');
  }
  if (path != null) {
    final size = await File(path).length();
    return assertAllowed(
      fileName: fileName,
      mimeType: mimeFromName(fileName, mimeType),
      path: path,
      sizeBytes: size,
      originalSizeBytes: size,
    );
  }
  final file = await writeTemp(bytes!, fileName);
  return assertAllowed(
    fileName: fileName,
    mimeType: mimeFromName(fileName, mimeType),
    path: file.path,
    sizeBytes: bytes.length,
    originalSizeBytes: bytes.length,
  );
}

Future<File> writeTemp(Uint8List bytes, String name) async {
  final dir = await getTemporaryDirectory();
  final file = File(p.join(dir.path, 'cc-${DateTime.now().millisecondsSinceEpoch}-$name'));
  await file.writeAsBytes(bytes, flush: true);
  return file;
}
