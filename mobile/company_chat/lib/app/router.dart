import 'package:company_chat/app/shell.dart';
import 'package:company_chat/core/notifications/pending_route.dart';
import 'package:company_chat/features/admin/presentation/admin_screens.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/auth/presentation/change_password_screen.dart';
import 'package:company_chat/features/auth/presentation/login_screen.dart';
import 'package:company_chat/features/auth/presentation/splash_screen.dart';
import 'package:company_chat/features/contacts/presentation/contacts_screen.dart';
import 'package:company_chat/features/conversations/presentation/chats_screen.dart';
import 'package:company_chat/features/groups/presentation/groups_screens.dart';
import 'package:company_chat/features/messages/presentation/chat_screen.dart';
import 'package:company_chat/features/profile/presentation/settings_screens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier(0);
  void bump() => refresh.value++;
  ref.listen(authControllerProvider, (_, _) => bump());
  pendingNotificationRoute.addListener(bump);
  ref.onDispose(() {
    pendingNotificationRoute.removeListener(bump);
    refresh.dispose();
  });

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final path = state.matchedLocation;
      if (auth.status == AuthStatus.unknown || auth.status == AuthStatus.unavailable) {
        return path == '/splash' ? null : '/splash';
      }
      if (!auth.isAuthenticated) {
        return path == '/login' ? null : '/login';
      }
      if (auth.mustChangePassword) {
        return path == '/change-password' ? null : '/change-password';
      }
      final pending = pendingNotificationRoute.conversationId;
      if (pending != null && path != '/chats/$pending') {
        return '/chats/$pending';
      }
      if (pending != null && path == '/chats/$pending') {
        pendingNotificationRoute.clearIf(pending);
      }
      if (path == '/login' || path == '/splash') return '/chats';
      if (path.startsWith('/admin') && !auth.isAdmin) return '/chats';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/change-password', builder: (_, _) => const ChangePasswordScreen()),
      GoRoute(
        path: '/chats/:id',
        builder: (_, state) => ChatScreen(conversationId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/groups/create', builder: (_, _) => const CreateGroupScreen()),
      GoRoute(
        path: '/groups/:id/info',
        builder: (_, state) => GroupInfoScreen(groupId: state.pathParameters['id']!),
      ),
      GoRoute(path: '/profile', builder: (_, _) => const ProfileScreen()),
      GoRoute(path: '/devices', builder: (_, _) => const DevicesScreen()),
      GoRoute(path: '/settings/notifications', builder: (_, _) => const NotificationSettingsScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => AppShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/chats', builder: (_, _) => const ChatsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/contacts', builder: (_, _) => const ContactsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/groups', builder: (_, _) => const GroupsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/settings', builder: (_, _) => const SettingsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/admin', builder: (_, _) => const AdminScreen())]),
        ],
      ),
    ],
  );
});
