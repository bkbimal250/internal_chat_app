import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/utils/preview_text.dart';
import 'package:flutter/material.dart';

class ReplyPreview extends StatelessWidget {
  const ReplyPreview({
    super.key,
    required this.message,
    this.currentUserId,
    this.onClose,
    this.compact = false,
  });

  final Map<String, dynamic> message;
  final String? currentUserId;
  final VoidCallback? onClose;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final senderId = message['senderId'] as String?;
    final mine = senderId != null && senderId == currentUserId;
    final name = mine
        ? 'You'
        : (message['senderName'] as String?)?.trim().isNotEmpty == true
            ? message['senderName'] as String
            : senderDisplayName(message, fallback: 'Message');
    final body = message['deletedAt'] != null || message['expiredAt'] != null
        ? 'Original message unavailable'
        : previewText(message);

    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(compact ? 10 : 12, compact ? 6 : 8, onClose == null ? 12 : 4, compact ? 6 : 8),
      decoration: BoxDecoration(
        color: compact ? AppColors.navy.withValues(alpha: 0.06) : AppColors.surface,
        borderRadius: BorderRadius.circular(compact ? 8 : 12),
        border: Border(
          left: BorderSide(color: AppColors.gold, width: 3),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.goldDeep,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  body,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, color: AppColors.slate),
                ),
              ],
            ),
          ),
          if (onClose != null)
            IconButton(
              tooltip: 'Cancel reply',
              onPressed: onClose,
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.close, size: 18, color: AppColors.slate),
            ),
        ],
      ),
    );
  }
}
