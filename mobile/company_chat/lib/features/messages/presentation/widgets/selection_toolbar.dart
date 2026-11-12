import 'package:company_chat/core/theme/app_colors.dart';
import 'package:flutter/material.dart';

class MessageSelectionActions extends StatelessWidget {
  const MessageSelectionActions({
    super.key,
    required this.compact,
    required this.showReply,
    required this.showForward,
    required this.showCopy,
    required this.showDelete,
    required this.showShare,
    this.onReply,
    this.onForward,
    this.onCopy,
    this.onDelete,
    this.onShare,
  });

  final bool compact;
  final bool showReply;
  final bool showForward;
  final bool showCopy;
  final bool showDelete;
  final bool showShare;
  final VoidCallback? onReply;
  final VoidCallback? onForward;
  final VoidCallback? onCopy;
  final VoidCallback? onDelete;
  final VoidCallback? onShare;

  @override
  Widget build(BuildContext context) {
    final overflow = <_Action>[
      if (compact && showCopy) _Action('copy', 'Copy', Icons.copy_outlined, onCopy),
      if (compact && showShare) _Action('share', 'Share', Icons.share_outlined, onShare),
    ];
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (showReply) _icon('Reply', Icons.reply, onReply),
        if (showForward) _icon('Forward', Icons.forward, onForward),
        if (showCopy && !compact) _icon('Copy', Icons.copy_outlined, onCopy),
        if (showDelete) _icon('Delete', Icons.delete_outline, onDelete, color: AppColors.ivory),
        if (showShare && !compact) _icon('Share', Icons.share_outlined, onShare),
        if (overflow.isNotEmpty)
          PopupMenuButton<String>(
            tooltip: 'More',
            onSelected: (value) {
              for (final action in overflow) {
                if (action.id == value) action.onTap?.call();
              }
            },
            itemBuilder: (context) => [
              for (final action in overflow)
                PopupMenuItem(
                  value: action.id,
                  child: ListTile(
                    dense: true,
                    leading: Icon(action.icon, color: AppColors.navy),
                    title: Text(action.label),
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
            ],
          ),
      ],
    );
  }

  Widget _icon(String tooltip, IconData icon, VoidCallback? onTap, {Color? color}) {
    return IconButton(
      tooltip: tooltip,
      onPressed: onTap,
      visualDensity: VisualDensity.compact,
      padding: const EdgeInsets.all(8),
      constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
      icon: Icon(icon, color: color),
    );
  }
}

class _Action {
  const _Action(this.id, this.label, this.icon, this.onTap);
  final String id;
  final String label;
  final IconData icon;
  final VoidCallback? onTap;
}
