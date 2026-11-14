import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/conversations/presentation/conversations_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen(conversationsControllerProvider, (_, _) {});
    final isAdmin = ref.watch(authControllerProvider).isAdmin;
    final destinations = [
      (Icons.chat_bubble_outline, Icons.chat_bubble, 'Chats'),
      (Icons.people_outline, Icons.people, 'People'),
      (Icons.groups_outlined, Icons.groups, 'Groups'),
      (Icons.settings_outlined, Icons.settings, 'Settings'),
      if (isAdmin) (Icons.admin_panel_settings_outlined, Icons.admin_panel_settings, 'Admin'),
    ];
    final index = navigationShell.currentIndex.clamp(0, destinations.length - 1);
    final expanded = AppBreakpoints.isExpanded(context);

    if (expanded) {
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: index,
              extended: MediaQuery.sizeOf(context).width >= 1100,
              backgroundColor: AppColors.navy,
              leading: const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: CircleAvatar(
                  backgroundColor: AppColors.sidebarAccent,
                  child: Text('M', style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.w700)),
                ),
              ),
              destinations: [
                for (final item in destinations)
                  NavigationRailDestination(
                    icon: Icon(item.$1),
                    selectedIcon: Icon(item.$2),
                    label: Text(item.$3),
                  ),
              ],
              onDestinationSelected: navigationShell.goBranch,
            ),
            const VerticalDivider(width: 1),
            Expanded(child: navigationShell),
          ],
        ),
      );
    }

    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        destinations: [
          for (final item in destinations)
            NavigationDestination(icon: Icon(item.$1), selectedIcon: Icon(item.$2), label: item.$3),
        ],
        onDestinationSelected: navigationShell.goBranch,
      ),
    );
  }
}
