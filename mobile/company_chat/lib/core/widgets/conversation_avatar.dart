import 'package:company_chat/core/widgets/user_avatar.dart';

class ConversationAvatar {
  static UserAvatar from({
    required Map<String, dynamic>? conversation,
    Map<String, dynamic>? peer,
    required String title,
    double size = 44,
    bool online = false,
  }) {
    final isGroup = conversation?['type'] == 'group';
    if (isGroup) {
      return UserAvatar(
        name: title,
        userId: conversation?['id'] as String?,
        hasPhoto: conversation?['hasAvatar'] == true,
        photoVersion: conversation?['avatarVersion']?.toString(),
        group: true,
        size: size,
      );
    }
    return UserAvatar(
      person: peer,
      name: title,
      userId: peer?['id'] as String?,
      hasPhoto: peer?['hasProfilePhoto'] == true,
      photoVersion: peer?['photoVersion']?.toString(),
      online: online,
      size: size,
    );
  }
}
