import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/widgets/empty_state.dart';
import 'package:company_chat/core/widgets/conversation_avatar.dart';
import 'package:flutter/material.dart';

Future<String?> showForwardPicker(
  BuildContext context, {
  required List<Map<String, dynamic>> conversations,
  required String currentConversationId,
  required String Function(Map<String, dynamic>) titleOf,
  Map<String, dynamic>? Function(Map<String, dynamic>)? peerOf,
}) {
  final targets = conversations.where((row) => row['id'] != currentConversationId).toList();
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (context) {
      return SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.62,
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(99)),
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 16, 20, 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Forward to', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                ),
              ),
              Expanded(
                child: targets.isEmpty
                    ? const EmptyState(
                        icon: Icons.forum_outlined,
                        title: 'No other chats',
                        description: 'Start another conversation before forwarding.',
                      )
                    : ListView.builder(
                        itemCount: targets.length,
                        itemBuilder: (context, index) {
                          final row = targets[index];
                          final isGroup = row['type'] == 'group';
                          final peer = peerOf?.call(row);
                          final title = titleOf(row);
                          return ListTile(
                            leading: ConversationAvatar.from(
                              conversation: row,
                              peer: peer,
                              title: title,
                              size: 40,
                            ),
                            title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
                            subtitle: Text(isGroup ? 'Group' : 'Chat', style: const TextStyle(color: AppColors.slate, fontSize: 12)),
                            onTap: () => Navigator.pop(context, row['id'] as String),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      );
    },
  );
}
