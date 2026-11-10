import 'package:company_chat/features/media/media_limits.dart';
import 'package:company_chat/features/media/media_prepare.dart';

class SelectedMedia {
  const SelectedMedia({required this.media, required this.identity});

  final PreparedMedia media;
  final String identity;
}

class BatchSelectionResult {
  const BatchSelectionResult({required this.items, required this.errors});

  final List<SelectedMedia> items;
  final List<String> errors;
}

String mediaIdentity(PreparedMedia media) => '${media.fileName}|${media.sizeBytes}|${media.path}';

BatchSelectionResult addSelectedMedia(
  List<SelectedMedia> current,
  Iterable<PreparedMedia> incoming, {
  int max = maxAttachmentBatch,
}) {
  final items = [...current];
  final errors = <String>[];
  final seen = items.map((item) => item.identity).toSet();
  for (final media in incoming) {
    final identity = mediaIdentity(media);
    if (seen.contains(identity)) {
      errors.add('${media.fileName} is already selected');
      continue;
    }
    if (items.length >= max) {
      errors.add('You can attach up to $max files at once');
      continue;
    }
    seen.add(identity);
    items.add(SelectedMedia(media: media, identity: identity));
  }
  return BatchSelectionResult(items: items, errors: errors);
}

List<Map<String, dynamic>> messageAttachments(Map<String, dynamic>? message) {
  final list = message?['attachments'];
  if (list is List && list.isNotEmpty) {
    return list.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
  }
  final one = message?['attachment'];
  if (one is Map) return [Map<String, dynamic>.from(one)];
  return [];
}
