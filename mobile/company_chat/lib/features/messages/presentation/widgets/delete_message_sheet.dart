import 'package:company_chat/core/theme/app_colors.dart';
import 'package:flutter/material.dart';

enum DeleteMessageChoice { me, everyone }

Future<DeleteMessageChoice?> showDeleteMessageSheet(
  BuildContext context, {
  required int count,
  required bool allowEveryone,
}) {
  final title = count == 1 ? 'Delete message?' : 'Delete $count messages?';
  final body = allowEveryone
      ? 'Delete for me removes it from your chat only. Delete for everyone removes it for both of you.'
      : count == 1
          ? 'This removes the message from your chat only. Other members still see it.'
          : 'This removes the selected messages from your chat only. Other members still see them.';
  return showModalBottomSheet<DeleteMessageChoice>(
    context: context,
    backgroundColor: AppColors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (context) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(99)),
                ),
              ),
              Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Text(body, style: const TextStyle(color: AppColors.slate, height: 1.4)),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => Navigator.pop(context, DeleteMessageChoice.me),
                style: FilledButton.styleFrom(backgroundColor: AppColors.error, foregroundColor: AppColors.white),
                child: const Text('Delete for me'),
              ),
              if (allowEveryone) ...[
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () => Navigator.pop(context, DeleteMessageChoice.everyone),
                  style: OutlinedButton.styleFrom(foregroundColor: AppColors.error),
                  child: const Text('Delete for everyone'),
                ),
              ],
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancel'),
              ),
            ],
          ),
        ),
      );
    },
  );
}
