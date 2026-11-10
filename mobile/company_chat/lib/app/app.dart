import 'package:company_chat/app/router.dart';
import 'package:company_chat/core/config/feature_flags.dart';
import 'package:company_chat/core/notifications/notification_coordinator.dart';
import 'package:company_chat/core/theme/app_theme.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/calls/call_host.dart';
import 'package:company_chat/features/calls/call_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class CompanyChatApp extends ConsumerWidget {
  const CompanyChatApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'MiChat',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      routerConfig: router,
      builder: (context, child) {
        ref.listen(authControllerProvider, (previous, next) {
          if (next.isAuthenticated) {
            ref.read(callControllerProvider.notifier).loadCapabilities();
            ref.read(featureFlagsProvider.notifier).refresh();
          }
        });
        return CallHost(child: NotificationHost(child: child ?? const SizedBox.shrink()));
      },
    );
  }
}
