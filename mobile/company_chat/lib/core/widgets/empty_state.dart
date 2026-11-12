import 'package:company_chat/core/theme/app_colors.dart';
import 'package:flutter/material.dart';

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.description,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String? description;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: AppColors.goldSoft,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Icon(icon, size: 30, color: AppColors.goldDeep),
              ),
              const SizedBox(height: 16),
              Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
              if (description != null) ...[
                const SizedBox(height: 8),
                Text(
                  description!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.slate, height: 1.4),
                ),
              ],
              if (onAction != null && actionLabel != null) ...[
                const SizedBox(height: 18),
                FilledButton(onPressed: onAction, child: Text(actionLabel!)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({
    super.key,
    this.title = "Couldn't load this screen",
    this.description = 'Please check your connection and try again.',
    this.onRetry,
  });

  final String title;
  final String description;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.wifi_off_rounded,
      title: title,
      description: description,
      actionLabel: onRetry == null ? null : 'Try again',
      onAction: onRetry,
    );
  }
}

class LoadingState extends StatelessWidget {
  const LoadingState({super.key, this.label = 'Loading…'});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 12),
          Text(label, style: const TextStyle(color: AppColors.slate)),
        ],
      ),
    );
  }
}
