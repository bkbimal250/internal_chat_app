import 'package:company_chat/core/config/feature_flags.dart';
import 'package:company_chat/core/notifications/pending_call.dart';
import 'package:company_chat/core/notifications/push_notifications.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/calls/call_models.dart';
import 'package:company_chat/features/calls/call_providers.dart';
import 'package:company_chat/features/calls/call_screens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class CallHost extends ConsumerStatefulWidget {
  const CallHost({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<CallHost> createState() => _CallHostState();
}

class _CallHostState extends ConsumerState<CallHost> {
  @override
  void initState() {
    super.initState();
    PushNotifications.onIncomingCall = (callId) {
      ref.read(callControllerProvider.notifier).handleIncomingPush(callId);
    };
    pendingCallRoute.addListener(_openPending);
    Future.microtask(() {
      if (!mounted) return;
      if (ref.read(authControllerProvider).isAuthenticated) {
        ref.read(callControllerProvider.notifier).loadCapabilities();
        ref.read(featureFlagsProvider.notifier).refresh();
      }
    });
  }

  @override
  void dispose() {
    pendingCallRoute.removeListener(_openPending);
    if (PushNotifications.onIncomingCall != null) {
      PushNotifications.onIncomingCall = null;
    }
    super.dispose();
  }

  void _openPending() {
    final id = pendingCallRoute.callId;
    if (id == null || id.isEmpty) return;
    final auth = ref.read(authControllerProvider);
    if (!auth.isAuthenticated) return;
    final action = pendingCallRoute.action;
    final controller = ref.read(callControllerProvider.notifier);
    if (action == 'accept') {
      controller.handleIncomingPush(id).then((_) => controller.accept(id));
    } else if (action == 'reject') {
      controller.reject(id);
    } else {
      controller.handleIncomingPush(id);
    }
    pendingCallRoute.clearIf(id);
  }

  @override
  Widget build(BuildContext context) {
    final call = ref.watch(callControllerProvider).active;
    return Stack(
      children: [
        widget.child,
        if (call != null && call.incoming)
          Positioned.fill(child: IncomingCallScreen(call: call))
        else if (call != null && call.phase != CallPhase.idle)
          Positioned.fill(child: ActiveCallScreen(call: call)),
      ],
    );
  }
}
