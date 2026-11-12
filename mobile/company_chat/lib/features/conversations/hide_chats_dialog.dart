import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/features/conversations/conversation_actions.dart';
import 'package:company_chat/features/conversations/conversation_hide.dart';
import 'package:flutter/material.dart';

Future<bool> confirmHideChats(BuildContext context, {required int count}) async {
  if (count <= 0) return false;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(hideChatsTitle(count)),
      content: const Text(hideChatsBody),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
      ],
    ),
  );
  return confirmed == true;
}

class ChatSelectionActions extends StatelessWidget {
  const ChatSelectionActions({
    super.key,
    required this.snapshot,
    required this.compact,
    required this.busy,
    this.onPin,
    this.onMute,
    this.onDelete,
    this.onArchive,
    this.onMarkRead,
    this.onMarkUnread,
  });

  final ChatSelectionSnapshot snapshot;
  final bool compact;
  final bool busy;
  final VoidCallback? onPin;
  final VoidCallback? onMute;
  final VoidCallback? onDelete;
  final VoidCallback? onArchive;
  final VoidCallback? onMarkRead;
  final VoidCallback? onMarkUnread;

  @override
  Widget build(BuildContext context) {
    final pinLabel = snapshot.allPinned ? 'Unpin' : 'Pin';
    final muteLabel = snapshot.allMuted ? 'Unmute' : 'Mute';
    final archiveLabel = snapshot.allArchived ? 'Unarchive' : 'Archive';
    final overflow = <_Action>[
      if (compact) _Action('pin', pinLabel, snapshot.allPinned ? Icons.push_pin : Icons.push_pin_outlined, onPin),
      if (compact) _Action('mute', muteLabel, snapshot.allMuted ? Icons.volume_up_outlined : Icons.volume_off_outlined, onMute),
      if (compact) _Action('archive', archiveLabel, snapshot.allArchived ? Icons.unarchive_outlined : Icons.archive_outlined, onArchive),
      if (snapshot.anyUnread) _Action('read', 'Mark as read', Icons.mark_chat_read_outlined, onMarkRead),
      if (snapshot.anyRead) _Action('unread', 'Mark as unread', Icons.mark_chat_unread_outlined, onMarkUnread),
    ];
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (busy)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 12),
            child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
          )
        else ...[
          if (!compact)
            _icon(pinLabel, snapshot.allPinned ? Icons.push_pin : Icons.push_pin_outlined, onPin),
          if (!compact)
            _icon(muteLabel, snapshot.allMuted ? Icons.volume_up_outlined : Icons.volume_off_outlined, onMute),
          _icon('Delete', Icons.delete_outline, onDelete),
          if (!compact)
            _icon(archiveLabel, snapshot.allArchived ? Icons.unarchive_outlined : Icons.archive_outlined, onArchive),
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
      ],
    );
  }

  Widget _icon(String tooltip, IconData icon, VoidCallback? onTap) {
    return IconButton(
      tooltip: tooltip,
      onPressed: busy ? null : onTap,
      visualDensity: VisualDensity.compact,
      padding: const EdgeInsets.all(8),
      constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
      icon: Icon(icon),
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
