import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/widgets/user_avatar.dart';
import 'package:flutter/material.dart';

class InAppNotice {
  const InAppNotice({
    required this.conversationId,
    required this.title,
    required this.body,
    this.senderId,
    this.hasPhoto = false,
    this.isGroup = false,
  });

  final String conversationId;
  final String title;
  final String body;
  final String? senderId;
  final bool hasPhoto;
  final bool isGroup;
}

class InAppBanner extends StatelessWidget {
  const InAppBanner({super.key, required this.notice, required this.onOpen, required this.onDismiss});

  final InAppNotice notice;
  final VoidCallback onOpen;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: Dismissible(
            key: ValueKey(notice.conversationId + notice.body),
            direction: DismissDirection.up,
            onDismissed: (_) => onDismiss(),
            child: Material(
              color: AppColors.card,
              elevation: 8,
              shadowColor: Colors.black26,
              borderRadius: BorderRadius.circular(16),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: onOpen,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Row(
                    children: [
                      UserAvatar(
                        name: notice.title,
                        userId: notice.isGroup ? null : notice.senderId,
                        hasPhoto: notice.hasPhoto,
                        group: notice.isGroup,
                        size: 40,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              notice.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                color: AppColors.foreground,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              notice.body,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: AppColors.mutedForeground, height: 1.25),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: onDismiss,
                        icon: const Icon(Icons.close, size: 18, color: AppColors.mutedForeground),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
