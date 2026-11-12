import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/notifications/notification_prefs.dart';
import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/utils/preview_text.dart';
import 'package:company_chat/core/utils/time_format.dart';
import 'package:company_chat/core/widgets/conversation_tile.dart';
import 'package:company_chat/core/widgets/empty_state.dart';
import 'package:company_chat/core/widgets/filter_chips.dart';
import 'package:company_chat/core/widgets/search_field.dart';
import 'package:company_chat/core/widgets/conversation_avatar.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/calls/call_providers.dart';
import 'package:company_chat/features/conversations/conversation_actions.dart';
import 'package:company_chat/features/conversations/hide_chats_dialog.dart';
import 'package:company_chat/features/conversations/presentation/conversations_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class ChatsScreen extends ConsumerWidget {
  const ChatsScreen({super.key, this.embedded = false, this.selectedId});

  final bool embedded;
  final String? selectedId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = _ChatsList(embedded: embedded, selectedId: selectedId);
    if (!embedded && AppBreakpoints.isExpanded(context)) {
      return Row(
        children: [
          SizedBox(width: AppBreakpoints.paneWidth(context), child: list),
          const VerticalDivider(width: 1),
          const Expanded(
            child: EmptyState(
              icon: Icons.forum_outlined,
              title: 'Select a conversation',
              description: 'Choose a chat from the list to start messaging.',
            ),
          ),
        ],
      );
    }
    return list;
  }
}

class _ChatsList extends ConsumerStatefulWidget {
  const _ChatsList({required this.embedded, this.selectedId});

  final bool embedded;
  final String? selectedId;

  @override
  ConsumerState<_ChatsList> createState() => _ChatsListState();
}

class _ChatsListState extends ConsumerState<_ChatsList> {
  final _search = TextEditingController();
  final _selected = <String>{};
  var _busy = false;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool get _selecting => _selected.isNotEmpty;

  void _toggleSelect(String id) {
    setState(() {
      if (_selected.contains(id)) {
        _selected.remove(id);
      } else {
        _selected.add(id);
      }
    });
  }

  List<Map<String, dynamic>> _selectedRows(ConversationsState state) {
    return [
      for (final row in state.source)
        if (_selected.contains(row['id'])) row,
    ];
  }

  ChatSelectionSnapshot _snapshot(ConversationsState state, Set<String> mutedIds) {
    return ChatSelectionSnapshot([
      for (final row in _selectedRows(state))
        {...row, 'mutedUntil': isMutedRow(row, mutedIds: mutedIds) ? row['mutedUntil'] ?? '9999-12-31T00:00:00.000Z' : null},
    ]);
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) setState(_selected.clear);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(conversationsControllerProvider);
    final controller = ref.read(conversationsControllerProvider.notifier);
    final me = ref.watch(authControllerProvider.select((s) => s.user?.id));
    final online = ref.watch(onlineUsersProvider);
    final typing = ref.watch(typingProvider);
    final callingEnabled = ref.watch(callControllerProvider.select((s) => s.capabilities.enabled));
    final mutedIds = ref.watch(notificationPrefsProvider.select((s) => s.mutedConversationIds));
    final showCalls = state.filter == 'calls';
    final snapshot = _snapshot(state, mutedIds.toSet());
    final compact = AppBreakpoints.widthOf(context) < 480;

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: !widget.embedded,
        title: _selecting
            ? Text('${_selected.length} selected')
            : const Text('MiChat'),
        leading: _selecting
            ? IconButton(
                tooltip: 'Cancel',
                onPressed: _busy ? null : () => setState(_selected.clear),
                icon: const Icon(Icons.close),
              )
            : null,
        actions: [
          if (_selecting)
            ChatSelectionActions(
              snapshot: snapshot,
              compact: compact,
              busy: _busy,
              onPin: () => _run(() => controller.pinConversations(_selected, pinned: !snapshot.allPinned)),
              onMute: () => _run(() => controller.muteConversations(_selected, muted: !snapshot.allMuted)),
              onDelete: () async {
                if (_busy) return;
                final confirmed = await confirmHideChats(context, count: _selected.length);
                if (!context.mounted || confirmed != true) return;
                await _run(() async {
                  final result = await controller.hideConversations(_selected);
                  if (result.failed.isEmpty || !context.mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(result.errorMessage)));
                });
              },
              onArchive: () => _run(() => controller.archiveConversations(_selected, archived: !snapshot.allArchived)),
              onMarkRead: () => _run(() => controller.markConversationsRead(_selected)),
              onMarkUnread: () => _run(() => controller.markConversationsUnread(_selected)),
            )
          else ...[
            IconButton(
              tooltip: 'Voice call',
              onPressed: () => controller.setFilter('calls'),
              icon: const Icon(Icons.call_outlined),
            ),
            PopupMenuButton<String>(
              tooltip: 'More',
              onSelected: (value) async {
                if (value == 'settings') context.go('/settings');
                if (value == 'profile') context.push('/profile');
                if (value == 'devices') context.push('/devices');
                if (value == 'help') _showHelp(context);
                if (value == 'logout') {
                  final confirmed = await showDialog<bool>(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text('Sign out?'),
                      content: const Text('You will need to sign in again to use MiChat.'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign out')),
                      ],
                    ),
                  );
                  if (confirmed == true) await ref.read(authControllerProvider.notifier).logout();
                }
              },
              itemBuilder: (context) => const [
                PopupMenuItem(value: 'settings', child: Text('Settings')),
                PopupMenuItem(value: 'profile', child: Text('Profile')),
                PopupMenuItem(value: 'devices', child: Text('Linked devices')),
                PopupMenuItem(value: 'help', child: Text('Help')),
                PopupMenuItem(value: 'logout', child: Text('Log out')),
              ],
            ),
          ],
        ],
      ),
      floatingActionButton: widget.embedded || _selecting
          ? null
          : FloatingActionButton(
              tooltip: 'New chat',
              onPressed: () => context.push('/contacts'),
              child: const Icon(Icons.chat),
            ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: MiChatSearchField(
              controller: _search,
              onChanged: controller.setQuery,
            ),
          ),
          MiChatFilterChips(
            selected: state.filter,
            onSelected: (id) {
              if (_selecting) setState(_selected.clear);
              controller.setFilter(id);
            },
            options: const [
              FilterOption('all', 'All'),
              FilterOption('unread', 'Unread'),
              FilterOption('groups', 'Groups'),
              FilterOption('archived', 'Archived'),
              FilterOption('calls', 'Calls'),
            ],
          ),
          const SizedBox(height: 6),
          Expanded(
            child: showCalls
                ? _CallsList(query: state.query, enabled: callingEnabled)
                : state.loading && state.items.isEmpty
                    ? const LoadingState(label: 'Loading conversations…')
                    : state.error != null && state.items.isEmpty
                        ? ErrorState(
                            title: "Couldn't load conversations",
                            description: "You're offline or the service is unavailable.",
                            onRetry: controller.load,
                          )
                        : state.visible.isEmpty
                            ? EmptyState(
                                icon: state.filter == 'archived' ? Icons.archive_outlined : Icons.chat_bubble_outline,
                                title: state.filter == 'archived' ? 'No archived chats' : 'No conversations yet',
                                description: state.filter == 'archived'
                                    ? 'Archived chats stay on this device and for you only. Messages are not deleted.'
                                    : 'Tap the new chat button to start messaging.',
                              )
                            : RefreshIndicator(
                                onRefresh: controller.load,
                                child: NotificationListener<ScrollNotification>(
                                  onNotification: (notification) {
                                    if (notification.metrics.extentAfter < 400) {
                                      controller.load(more: true);
                                    }
                                    return false;
                                  },
                                  child: ListView.builder(
                                    itemCount: state.visible.length + (state.loadingMore ? 1 : 0),
                                    itemBuilder: (context, index) {
                                      if (index >= state.visible.length) {
                                        return const Padding(
                                          padding: EdgeInsets.all(16),
                                          child: Center(child: CircularProgressIndicator()),
                                        );
                                      }
                                      final conversation = state.visible[index];
                                      final peer = controller.peer(conversation);
                                      final title = controller.titleOf(conversation);
                                      final isGroup = conversation['type'] == 'group';
                                      final unread = (conversation['unreadCount'] as num?)?.toInt() ?? 0;
                                      final id = conversation['id'] as String;
                                      final isTyping = (typing[id] ?? {}).isNotEmpty;
                                      final muted = mutedIds.contains(id) ||
                                          DateTime.tryParse(conversation['mutedUntil']?.toString() ?? '')?.isAfter(DateTime.now()) == true;
                                      final latest = conversation['latestMessage'] as Map<String, dynamic>?;
                                      final outgoing = latest != null && latest['senderId'] == me;
                                      final seq = (latest?['sequenceNumber'] as num?)?.toInt() ?? 0;
                                      final read = !isGroup &&
                                          outgoing &&
                                          (((peer?['lastReadSeq'] as num?)?.toInt() ?? 0) >= seq && seq > 0);
                                      return RepaintBoundary(
                                        child: ConversationTile(
                                          title: title,
                                          preview: conversationPreview(
                                            conversation,
                                            currentUserId: me,
                                            typing: isTyping,
                                          ),
                                          time: formatMessageTime(
                                            latest?['createdAt'] ?? conversation['updatedAt'],
                                          ),
                                          unread: unread,
                                          selected: widget.selectedId == id || _selected.contains(id),
                                          typing: isTyping,
                                          muted: muted,
                                          pinned: isPinned(conversation),
                                          leadingIcon: outgoing
                                              ? Icon(
                                                  latest['failed'] == true
                                                      ? Icons.error_outline
                                                      : latest['pending'] == true
                                                          ? Icons.access_time
                                                          : read
                                                              ? Icons.done_all
                                                              : Icons.done,
                                                  size: 16,
                                                  color: latest['failed'] == true
                                                      ? AppColors.error
                                                      : read
                                                          ? AppColors.goldDeep
                                                          : AppColors.slate,
                                                )
                                              : null,
                                          avatar: ConversationAvatar.from(
                                            conversation: conversation,
                                            peer: peer,
                                            title: title,
                                            online: !isGroup && online.contains(peer?['id']),
                                            size: AppSpacing.avatar,
                                          ),
                                          onLongPress: () => _toggleSelect(id),
                                          onTap: () {
                                            if (_selecting) {
                                              _toggleSelect(id);
                                              return;
                                            }
                                            if (widget.embedded || AppBreakpoints.isExpanded(context)) {
                                              context.go('/chats/$id');
                                            } else {
                                              context.push('/chats/$id');
                                            }
                                          },
                                        ),
                                      );
                                    },
                                  ),
                                ),
                              ),
          ),
        ],
      ),
    );
  }

  void _showHelp(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('How to use MiChat'),
        content: const Text(
          'Open a chat to send a message.\n\n'
          'Swipe a message right or tap Reply to answer it.\n\n'
          'Tap the phone icon to start a live voice call. Calls are not recorded or saved.',
        ),
        actions: [
          FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Got it')),
        ],
      ),
    );
  }
}

class _CallsList extends ConsumerWidget {
  const _CallsList({required this.query, required this.enabled});

  final String query;
  final bool enabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!enabled) {
      return const EmptyState(
        icon: Icons.call_outlined,
        title: 'Voice calling is not enabled',
        description: 'Live calling will appear here once it is turned on for your workspace. Calls are never recorded or saved.',
      );
    }
    final conversations = ref.watch(conversationsControllerProvider);
    final controller = ref.read(conversationsControllerProvider.notifier);
    final needle = query.trim().toLowerCase();
    final people = conversations.items.where((row) {
      if (row['type'] != 'direct') return false;
      if (needle.isEmpty) return true;
      return controller.titleOf(row).toLowerCase().contains(needle);
    }).toList();
    if (people.isEmpty) {
      return const EmptyState(
        icon: Icons.call_outlined,
        title: 'Start a live voice call',
        description: 'Open a chat and tap the call icon. Voice calls are live only — MiChat does not record or save them.',
      );
    }
    return ListView.builder(
      itemCount: people.length + 1,
      itemBuilder: (context, index) {
        if (index == 0) {
          return const Padding(
            padding: EdgeInsets.fromLTRB(20, 12, 20, 8),
            child: Text(
              'Voice calls are live only. MiChat does not record or save conversations.',
              style: TextStyle(color: AppColors.slate, fontSize: 13),
            ),
          );
        }
        final conversation = people[index - 1];
        final peer = controller.peer(conversation);
        final title = controller.titleOf(conversation);
        final peerId = peer?['id'] as String?;
        return ConversationTile(
          title: title,
          preview: 'Tap to start a live voice call',
          time: '',
          avatar: ConversationAvatar.from(
            conversation: conversation,
            peer: peer,
            title: title,
            size: AppSpacing.avatar,
          ),
          trailing: IconButton(
            tooltip: 'Voice call',
            onPressed: peerId == null
                ? null
                : () => ref.read(callControllerProvider.notifier).startCall(
                      userId: peerId,
                      name: title,
                      hasPhoto: peer?['hasProfilePhoto'] == true,
                      photoVersion: peer?['photoVersion']?.toString(),
                    ),
            icon: const Icon(Icons.call, color: AppColors.gold),
          ),
          onTap: peerId == null
              ? () {}
              : () => ref.read(callControllerProvider.notifier).startCall(
                    userId: peerId,
                    name: title,
                    hasPhoto: peer?['hasProfilePhoto'] == true,
                    photoVersion: peer?['photoVersion']?.toString(),
                  ),
        );
      },
    );
  }
}
