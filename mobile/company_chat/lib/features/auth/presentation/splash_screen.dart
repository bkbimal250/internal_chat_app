import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/widgets/brand_mark.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unavailable = ref.watch(authControllerProvider).status == AuthStatus.unavailable;
    return Scaffold(
      backgroundColor: AppColors.navy,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const BrandMark(inverted: true),
                const SizedBox(height: 28),
                if (unavailable) ...[
                  const Text(
                    "You're offline. Trying to reconnect.",
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.ivory, fontSize: 15),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () => ref.read(authControllerProvider.notifier).restore(),
                    child: const Text('Try again'),
                  ),
                ] else ...[
                  const CircularProgressIndicator(color: AppColors.gold),
                  const SizedBox(height: 16),
                  const Text(
                    'Restoring your session…',
                    style: TextStyle(color: AppColors.ivory),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
