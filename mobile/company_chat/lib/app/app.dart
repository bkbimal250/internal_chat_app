import 'package:company_chat/app/router.dart';
import 'package:company_chat/core/notifications/notification_coordinator.dart';
import 'package:company_chat/core/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class CompanyChatApp extends ConsumerWidget {
  const CompanyChatApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Company Chat',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      routerConfig: router,
      builder: (context, child) => NotificationHost(child: child ?? const SizedBox.shrink()),
    );
  }
}
