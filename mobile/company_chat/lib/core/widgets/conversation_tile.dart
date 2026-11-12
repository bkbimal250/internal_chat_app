import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/widgets/user_avatar.dart';
import 'package:flutter/material.dart';

class ConversationTile extends StatelessWidget {
  const ConversationTile({
    super.key,
    required this.title,
    required this.preview,
    required this.time,
    required this.onTap,
    this.onLongPress,
    this.avatar,
    this.unread = 0,
    this.selected = false,
    this.typing = false,
    this.muted = false,
    this.pinned = false,
    this.leadingIcon,
    this.trailing,
  });

  final String title;
  final String preview;
  final String time;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final Widget? avatar;
  final int unread;
  final bool selected;
  final bool typing;
  final bool muted;
  final bool pinned;
  final Widget? leadingIcon;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final unreadStyle = unread > 0;
    return Material(
      color: selected ? AppColors.selection : Colors.transparent,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: AppSpacing.listRow),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                avatar ?? const UserAvatar(name: '?'),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: unreadStyle ? FontWeight.w700 : FontWeight.w600,
                                color: AppColors.navy,
                              ),
                            ),
                          ),
                          if (pinned) ...[
                            const Icon(Icons.push_pin, size: 14, color: AppColors.slate),
                            const SizedBox(width: 6),
                          ],
                          const SizedBox(width: 8),
                          Text(
                            time,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: unreadStyle ? FontWeight.w700 : FontWeight.w500,
                              color: unreadStyle ? AppColors.goldDeep : AppColors.slate,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          if (leadingIcon != null) ...[
                            leadingIcon!,
                            const SizedBox(width: 4),
                          ],
                          Expanded(
                            child: Text(
                              preview,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 13.5,
                                color: typing ? AppColors.goldDeep : AppColors.slate,
                                fontWeight: typing || unreadStyle ? FontWeight.w600 : FontWeight.w400,
                              ),
                            ),
                          ),
                          if (muted) ...[
                            const SizedBox(width: 6),
                            const Icon(Icons.volume_off, size: 16, color: AppColors.slate),
                          ],
                          if (unread > 0) ...[
                            const SizedBox(width: 8),
                            Container(
                              constraints: const BoxConstraints(minWidth: 22, minHeight: 22),
                              padding: const EdgeInsets.symmetric(horizontal: 6),
                              decoration: BoxDecoration(
                                color: AppColors.gold,
                                borderRadius: BorderRadius.circular(99),
                              ),
                              alignment: Alignment.center,
                              child: Text(
                                unread > 99 ? '99+' : '$unread',
                                style: const TextStyle(
                                  color: AppColors.navy,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
                ?trailing,
              ],
            ),
          ),
        ),
      ),
    );
  }
}
