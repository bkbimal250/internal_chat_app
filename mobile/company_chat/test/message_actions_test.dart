import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/features/messages/message_actions.dart';
import 'package:company_chat/features/messages/message_share.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _text({
  String id = '1',
  String sender = 'me',
  String content = 'Hello',
  Object? deletedAt,
  String type = 'text',
  DateTime? createdAt,
}) {
  return {
    'id': id,
    'senderId': sender,
    'content': content,
    'messageType': type,
    'deletedAt': deletedAt,
    'createdAt': (createdAt ?? DateTime.now().toUtc()).toIso8601String(),
  };
}

void main() {
  test('single selection prefers reply, copy, forward, delete and text share', () {
    final selected = [_text()];
    expect(selectionCanReply(selected), isTrue);
    expect(selectionCanCopy(selected), isTrue);
    expect(selectionCanForward(selected), isTrue);
    expect(selectionCanDelete(selected), isTrue);
    expect(selectionCanShare(selected), isTrue);
  });

  test('multiple selection hides reply and still supports copy forward delete share', () {
    final selected = [_text(id: '1'), _text(id: '2', content: 'Later')];
    expect(selectionCanReply(selected), isFalse);
    expect(selectionCanCopy(selected), isTrue);
    expect(selectionCanForward(selected), isTrue);
    expect(selectionCanDelete(selected), isTrue);
    expect(copySelectedText(selected), 'Hello\n\nLater');
  });

  test('delete for everyone is limited to own recent direct messages', () {
    final fresh = _text();
    final old = _text(createdAt: DateTime.now().toUtc().subtract(const Duration(minutes: 20)));
    final theirs = _text(sender: 'other');
    expect(
      canDeleteForEveryone(fresh, currentUserId: 'me', conversationType: 'direct'),
      isTrue,
    );
    expect(
      canDeleteForEveryone(fresh, currentUserId: 'me', conversationType: 'group'),
      isFalse,
    );
    expect(
      canDeleteForEveryone(old, currentUserId: 'me', conversationType: 'direct'),
      isFalse,
    );
    expect(
      canDeleteForEveryone(theirs, currentUserId: 'me', conversationType: 'direct'),
      isFalse,
    );
    expect(
      selectionCanDeleteForEveryone([fresh, theirs], currentUserId: 'me', conversationType: 'direct'),
      isFalse,
    );
    expect(
      selectionCanDeleteForEveryone([fresh, _text(id: '9')], currentUserId: 'me', conversationType: 'direct'),
      isTrue,
    );
  });

  test('deleted and system messages cannot be copied forwarded or shared', () {
    expect(canCopyMessage(_text(deletedAt: 'now')), isFalse);
    expect(canForwardMessage(_text(type: 'system', content: 'joined')), isFalse);
    expect(canShareText(_text(content: '')), isFalse);
    expect(canShareFiles(_text()), isFalse);
    expect(isSelectableMessage(_text(type: 'system')), isFalse);
  });

  test('external share sends joined text and rejects file-only selections', () async {
    final shared = <String>[];
    final share = MessageShare(shareTextFn: (text) async => shared.add(text));
    await share.share([_text(content: 'One'), _text(id: '2', content: 'Two')]);
    expect(shared, ['One\n\nTwo']);
    expect(
      () => share.share([
        {
          'id': 'img',
          'messageType': 'image',
          'content': '',
          'attachment': {'id': 'a'},
        },
      ]),
      throwsA(
        isA<ApiError>().having((error) => error.code, 'code', 'SHARE_UNAVAILABLE'),
      ),
    );
  });

  test('forward content falls back to a media label instead of empty body', () {
    expect(
      forwardContent({'messageType': 'image', 'content': ''}),
      'Photo',
    );
  });
}
