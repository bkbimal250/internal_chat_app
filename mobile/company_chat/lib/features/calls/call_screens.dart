import 'dart:async';

import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/widgets/user_avatar.dart';
import 'package:company_chat/features/calls/call_models.dart';
import 'package:company_chat/features/calls/call_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class IncomingCallScreen extends ConsumerStatefulWidget {
  const IncomingCallScreen({super.key, required this.call});

  final ActiveCall call;

  @override
  ConsumerState<IncomingCallScreen> createState() => _IncomingCallScreenState();
}

class _IncomingCallScreenState extends ConsumerState<IncomingCallScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final call = widget.call;
    return Material(
      color: AppColors.sidebar,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
          child: Column(
            children: [
              const Text('MiChat', style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.w700, letterSpacing: 0.4)),
              const SizedBox(height: 8),
              Text(callStatusLabel(call.phase, outgoing: false), style: const TextStyle(color: AppColors.sidebarForeground, fontWeight: FontWeight.w500)),
              const Spacer(),
              ScaleTransition(
                scale: Tween(begin: 0.96, end: 1.04).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut)),
                child: UserAvatar(
                  name: call.peerName,
                  userId: call.peerId,
                  hasPhoto: call.hasPhoto,
                  photoVersion: call.photoVersion,
                  size: 118,
                ),
              ),
              const SizedBox(height: 22),
              Text(
                call.peerName,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.sidebarForeground, fontSize: 28, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              const Text('Incoming voice call', style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.w600)),
              const Spacer(),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  CallRoundButton(
                    color: AppColors.destructive,
                    icon: Icons.call_end,
                    label: 'Decline',
                    onTap: () => ref.read(callControllerProvider.notifier).reject(call.id),
                  ),
                  CallRoundButton(
                    color: AppColors.unread,
                    icon: Icons.call,
                    label: 'Accept',
                    onTap: () => ref.read(callControllerProvider.notifier).accept(call.id),
                  ),
                ],
              ),
              const SizedBox(height: 28),
            ],
          ),
        ),
      ),
    );
  }
}

class ActiveCallScreen extends ConsumerStatefulWidget {
  const ActiveCallScreen({super.key, required this.call});

  final ActiveCall call;

  @override
  ConsumerState<ActiveCallScreen> createState() => _ActiveCallScreenState();
}

class _ActiveCallScreenState extends ConsumerState<ActiveCallScreen> {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final call = ref.watch(callControllerProvider.select((s) => s.active)) ?? widget.call;
    final connected = call.connectedAt;
    final elapsed = connected == null ? null : DateTime.now().difference(connected);
    return Scaffold(
      backgroundColor: AppColors.sidebar,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            children: [
              Offstage(
                offstage: true,
                child: SizedBox(
                  width: 1,
                  height: 1,
                  child: ref.read(callControllerProvider.notifier).remoteMediaView(),
                ),
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: IconButton(
                  tooltip: 'Close',
                  onPressed: call.isLive ? null : () => ref.read(callControllerProvider.notifier).dismissTerminal(),
                  icon: const Icon(Icons.close, color: AppColors.sidebarForeground),
                ),
              ),
              const Spacer(),
              UserAvatar(
                name: call.peerName,
                userId: call.peerId,
                hasPhoto: call.hasPhoto,
                photoVersion: call.photoVersion,
                size: 112,
              ),
              const SizedBox(height: 20),
              Text(
                call.peerName,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.sidebarForeground, fontSize: 26, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 10),
              Text(
                elapsed == null ? callStatusLabel(call.phase, outgoing: call.outgoing) : _formatElapsed(elapsed),
                style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.w600, fontSize: 16),
              ),
              if (call.error != null) ...[
                const SizedBox(height: 12),
                Text(call.error!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.destructive)),
              ],
              const Spacer(),
              if (call.isLive)
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    CallRoundButton(
                      color: call.muted ? AppColors.gold : AppColors.sidebarAccent,
                      icon: call.muted ? Icons.mic_off : Icons.mic_none,
                      label: call.muted ? 'Unmute' : 'Mute',
                      onTap: () => ref.read(callControllerProvider.notifier).toggleMute(),
                    ),
                    CallRoundButton(
                      color: AppColors.destructive,
                      icon: Icons.call_end,
                      label: call.outgoing && call.phase != CallPhase.connected ? 'Cancel' : 'End',
                      onTap: () => ref.read(callControllerProvider.notifier).cancel(),
                    ),
                    CallRoundButton(
                      color: call.speaker ? AppColors.gold : AppColors.sidebarAccent,
                      icon: call.speaker ? Icons.volume_up : Icons.hearing,
                      label: 'Speaker',
                      onTap: () => ref.read(callControllerProvider.notifier).toggleSpeaker(),
                    ),
                  ],
                )
              else
                FilledButton(
                  onPressed: () => ref.read(callControllerProvider.notifier).dismissTerminal(),
                  child: const Text('Close'),
                ),
              const SizedBox(height: 28),
            ],
          ),
        ),
      ),
    );
  }

  String _formatElapsed(Duration duration) {
    final hours = duration.inHours;
    final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
    if (hours > 0) return '$hours:$minutes:$seconds';
    return '$minutes:$seconds';
  }
}

class CallRoundButton extends StatelessWidget {
  const CallRoundButton({
    super.key,
    required this.color,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final Color color;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Material(
          color: color,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: 72,
              height: 72,
              child: Icon(icon, color: AppColors.sidebarForeground, size: 30),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(label, style: const TextStyle(color: AppColors.sidebarForeground, fontSize: 12, fontWeight: FontWeight.w600)),
      ],
    );
  }
}
