const twoGib = 2 * 1024 * 1024 * 1024;
const singlePutMaxBytes = 8 * 1024 * 1024;
const multipartPartSize = 8 * 1024 * 1024;

class MediaSpec {
  const MediaSpec({required this.kind, required this.maxBytes, required this.compressible});
  final String kind;
  final int maxBytes;
  final bool compressible;
}

const allowedTypes = <String, MediaSpec>{
  'image/jpeg': MediaSpec(kind: 'image', maxBytes: 25 * 1024 * 1024, compressible: true),
  'image/png': MediaSpec(kind: 'image', maxBytes: 25 * 1024 * 1024, compressible: true),
  'image/webp': MediaSpec(kind: 'image', maxBytes: 25 * 1024 * 1024, compressible: true),
  'image/gif': MediaSpec(kind: 'image', maxBytes: 25 * 1024 * 1024, compressible: false),
  'video/mp4': MediaSpec(kind: 'video', maxBytes: twoGib, compressible: true),
  'video/webm': MediaSpec(kind: 'video', maxBytes: twoGib, compressible: true),
  'video/quicktime': MediaSpec(kind: 'video', maxBytes: twoGib, compressible: true),
  'audio/mpeg': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/mp3': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/mp4': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/x-m4a': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/m4a': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/aac': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/ogg': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/opus': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/wav': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/x-wav': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/webm': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/3gpp': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'audio/amr': MediaSpec(kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false),
  'video/3gpp': MediaSpec(kind: 'video', maxBytes: twoGib, compressible: true),
  'video/3gpp2': MediaSpec(kind: 'video', maxBytes: twoGib, compressible: true),
  'application/pdf': MediaSpec(kind: 'file', maxBytes: twoGib, compressible: false),
  'application/zip': MediaSpec(kind: 'file', maxBytes: twoGib, compressible: false),
  'application/x-zip-compressed': MediaSpec(kind: 'file', maxBytes: twoGib, compressible: false),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': MediaSpec(
    kind: 'file',
    maxBytes: twoGib,
    compressible: false,
  ),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': MediaSpec(
    kind: 'file',
    maxBytes: twoGib,
    compressible: false,
  ),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': MediaSpec(
    kind: 'file',
    maxBytes: twoGib,
    compressible: false,
  ),
  'text/plain': MediaSpec(kind: 'file', maxBytes: 8 * 1024 * 1024, compressible: false),
};

enum MediaQuality { auto, high, dataSaver, original }

String formatMediaSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(bytes < 10 * 1024 ? 1 : 0)} KB';
  if (bytes < 1024 * 1024 * 1024) {
    return '${(bytes / (1024 * 1024)).toStringAsFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB';
  }
  return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
}

String formatEta(Duration? value) {
  if (value == null || value.inSeconds <= 0) return '';
  if (value.inSeconds < 60) return '${value.inSeconds}s left';
  if (value.inMinutes < 60) return '${value.inMinutes}m left';
  return '${(value.inMinutes / 60).toStringAsFixed(1)}h left';
}
