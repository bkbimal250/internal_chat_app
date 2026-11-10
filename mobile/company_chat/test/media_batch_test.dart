import 'package:company_chat/features/media/media_batch.dart';
import 'package:company_chat/features/media/media_limits.dart';
import 'package:company_chat/features/media/media_prepare.dart';
import 'package:flutter_test/flutter_test.dart';

PreparedMedia media(String name, {String kind = 'image', int size = 12, String path = ''}) {
  return PreparedMedia(
    fileName: name,
    mimeType: kind == 'image' ? 'image/png' : kind == 'video' ? 'video/mp4' : kind == 'audio' ? 'audio/mpeg' : 'application/pdf',
    path: path.isEmpty ? '/tmp/$name' : path,
    sizeBytes: size,
    originalSizeBytes: size,
    kind: kind,
  );
}

void main() {
  test('accepts 1, 10 and 50 files and rejects the 51st', () {
    expect(addSelectedMedia(const [], [media('one.png')]).items, hasLength(1));
    final ten = List.generate(10, (index) => media('n$index.png'));
    expect(addSelectedMedia(const [], ten).items, hasLength(10));
    final fifty = List.generate(50, (index) => media('f$index.png'));
    final full = addSelectedMedia(const [], fifty);
    expect(full.items, hasLength(maxAttachmentBatch));
    final overflow = addSelectedMedia(full.items, [media('overflow.png')]);
    expect(overflow.items, hasLength(50));
    expect(overflow.errors.single, contains('50'));
  });

  test('keeps mixed types and skips duplicates', () {
    final mixed = [
      media('a.png'),
      media('b.mp4', kind: 'video'),
      media('c.mp3', kind: 'audio'),
      media('d.pdf', kind: 'file'),
    ];
    final selected = addSelectedMedia(const [], mixed);
    expect(selected.items.map((item) => item.media.kind), ['image', 'video', 'audio', 'file']);
    final again = addSelectedMedia(selected.items, [media('a.png')]);
    expect(again.items, hasLength(4));
    expect(again.errors.single, contains('already selected'));
  });

  test('reads batched and legacy attachment payloads in order', () {
    expect(
      messageAttachments({
        'attachments': [
          {'id': 'a'},
          {'id': 'b'},
        ],
      }).map((row) => row['id']),
      ['a', 'b'],
    );
    expect(messageAttachments({'attachment': {'id': 'legacy'}})[0]['id'], 'legacy');
  });
}
