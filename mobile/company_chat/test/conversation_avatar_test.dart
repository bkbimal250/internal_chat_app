import 'package:company_chat/core/widgets/conversation_avatar.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('direct chats use the other participant photo, not the group avatar flag', () {
    final avatar = ConversationAvatar.from(
      conversation: {'id': 'c1', 'type': 'direct', 'hasAvatar': false, 'avatarVersion': '9'},
      peer: {
        'id': 'user-2',
        'displayName': 'Ana',
        'hasProfilePhoto': true,
        'photoVersion': 'v3',
      },
      title: 'Ana',
    );
    expect(avatar.userId, 'user-2');
    expect(avatar.hasPhoto, isTrue);
    expect(avatar.photoVersion, 'v3');
    expect(avatar.group, isFalse);
  });

  test('group chats keep the group avatar fields', () {
    final avatar = ConversationAvatar.from(
      conversation: {'id': 'g1', 'type': 'group', 'hasAvatar': true, 'avatarVersion': '4'},
      peer: {'id': 'user-2', 'hasProfilePhoto': true, 'photoVersion': 'v3'},
      title: 'Ops',
    );
    expect(avatar.userId, 'g1');
    expect(avatar.hasPhoto, isTrue);
    expect(avatar.photoVersion, '4');
    expect(avatar.group, isTrue);
  });

  test('missing photos fall back to initials without a user fetch', () {
    final avatar = ConversationAvatar.from(
      conversation: {'id': 'c2', 'type': 'direct'},
      peer: {'id': 'user-9', 'displayName': 'Bo', 'hasProfilePhoto': false},
      title: 'Bo',
    );
    expect(avatar.userId, 'user-9');
    expect(avatar.hasPhoto, isFalse);
  });
}
