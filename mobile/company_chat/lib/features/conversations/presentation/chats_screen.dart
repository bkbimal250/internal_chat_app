import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/utils/preview_text.dart';
import 'package:company_chat/core/utils/time_format.dart';
import 'package:company_chat/core/widgets/empty_state.dart';
import 'package:company_chat/core/widgets/user_avatar.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/conversations/presentation/conversations_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class ChatsScreen extends ConsumerWidget {
  const ChatsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(conversationsControllerProvider);
    final controller = ref.read(conversationsControllerProvider.notifier);
    final online = ref.watch(onlineUsersProvider);
    final user = ref.watch(authControllerProvider).user;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Chats'),
        actions: [
          IconButton(
            onPressed: () => context.push('/contacts'),
            icon: const Icon(Icons.person_add_alt_1_outlined),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/groups/create'),
        child: const Icon(Icons.group_add),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              onChanged: controller.setQuery,
              decoration: const InputDecoration(
                hintText: 'Search',
                prefixIcon: Icon(Icons.search),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'all', label: Text('All')),
                ButtonSegment(value: 'unread', label: Text('Unread')),
                ButtonSegment(value: 'groups', label: Text('Groups')),
              ],
              selected: {state.filter},
              onSelectionChanged: (value) => controller.setFilter(value.first),
            ),
          ),
          Expanded(
            child: state.loading
                ? const Center(child: CircularProgressIndicator())
                : state.visible.isEmpty
                    ? const EmptyState(
                        icon: Icons.chat_bubble_outline,
                        title: 'No conversations',
                        description: 'Start a chat or create a group to begin.',
                      )
                    : RefreshIndicator(
                        onRefresh: controller.load,
                        child: ListView.builder(
                          itemCount: state.visible.length,
                          itemBuilder: (context, index) {
                            final conversation = state.visible[index];
                            final peer = controller.peer(conversation);
                            final title = controller.titleOf(conversation);
                            final isGroup = conversation['type'] == 'group';
                            final unread = (conversation['unreadCount'] as num?)?.toInt() ?? 0;
                            return ListTile(
                              onTap: () => context.push('/chats/${conversation['id']}'),
                              leading: UserAvatar(
                                person: isGroup ? null : peer,
                                name: title,
                                userId: isGroup ? conversation['id'] as String? : null,
                                hasPhoto: conversation['hasAvatar'] == true,
                                photoVersion: conversation['avatarVersion']?.toString(),
                                group: isGroup,
                                online: !isGroup && online.contains(peer?['id']),
                              ),
                              title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
                              subtitle: Text(
                                (ref.watch(typingProvider)[conversation['id']] ?? {}).isNotEmpty
                                    ? 'typing…'
                                    : previewText(conversation['latestMessage'] as Map<String, dynamic>?),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: (ref.watch(typingProvider)[conversation['id']] ?? {}).isNotEmpty
                                    ? const TextStyle(color: AppColors.gold)
                                    : null,
                              ),
                              trailing: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(
                                    formatMessageTime(
                                      (conversation['latestMessage'] as Map?)?['createdAt'] ??
                                          conversation['updatedAt'],
                                    ),
                                    style: const TextStyle(fontSize: 11, color: AppColors.mutedForeground),
                                  ),
                                  if (unread > 0) ...[
                                    const SizedBox(height: 6),
                                    CircleAvatar(
                                      radius: 10,
                                      backgroundColor: AppColors.unread,
                                      child: Text(
                                        unread > 99 ? '99+' : '$unread',
                                        style: const TextStyle(color: Colors.white, fontSize: 10),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            );
                          },
                        ),
                      ),
          ),
          if (user != null)
            Padding(
              padding: const EdgeInsets.all(8),
              child: Text(
                'Signed in as ${user.displayName}',
                style: const TextStyle(color: AppColors.mutedForeground, fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }
}
