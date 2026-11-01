import 'dart:io';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/notifications/notification_prefs.dart';
import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/widgets/user_avatar.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:company_chat/features/media/media_prepare.dart';
import 'package:image_picker/image_picker.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          ListTile(
            leading: UserAvatar(
              name: user?.displayName,
              url: user?.profilePhotoUrl,
              userId: user?.id,
              hasPhoto: user?.hasProfilePhoto,
              photoVersion: user?.photoVersion,
              size: 52,
            ),
            title: Text(user?.displayName ?? ''),
            subtitle: Text('@${user?.username ?? ''} · ${user?.role}'),
            onTap: () => context.push('/profile'),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.lock_outline, color: AppColors.gold),
            title: const Text('Change password'),
            onTap: () => context.push('/change-password'),
          ),
          ListTile(
            leading: const Icon(Icons.devices_other_outlined, color: AppColors.gold),
            title: const Text('Devices and sessions'),
            onTap: () => context.push('/devices'),
          ),
          ListTile(
            leading: const Icon(Icons.notifications_outlined, color: AppColors.gold),
            title: const Text('Notifications'),
            subtitle: const Text('Sound, preview, mute, and reminders'),
            onTap: () => context.push('/settings/notifications'),
          ),
          const ListTile(
            leading: Icon(Icons.schedule_outlined, color: AppColors.gold),
            title: Text('Chat retention'),
            subtitle: Text(
              'Messages older than 90 days are automatically deleted according to your company\'s retention policy.',
            ),
          ),
          ListTile(
            leading: const Icon(Icons.logout, color: AppColors.destructive),
            title: const Text('Sign out'),
            onTap: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
    );
  }
}

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  late final TextEditingController _display;
  late final TextEditingController _full;
  late final TextEditingController _email;
  late final TextEditingController _phone;
  late final TextEditingController _address;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final user = ref.read(authControllerProvider).user;
    _display = TextEditingController(text: user?.displayName);
    _full = TextEditingController(text: user?.fullName);
    _email = TextEditingController(text: user?.email);
    _phone = TextEditingController(text: user?.phoneE164);
    _address = TextEditingController(text: user?.address);
  }

  @override
  void dispose() {
    _display.dispose();
    _full.dispose();
    _email.dispose();
    _phone.dispose();
    _address.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authControllerProvider).user;
    return Scaffold(
      appBar: AppBar(title: const Text('Your info')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Center(
            child: UserAvatar(
              name: user?.displayName,
              url: user?.profilePhotoUrl,
              userId: user?.id,
              hasPhoto: user?.hasProfilePhoto,
              photoVersion: user?.photoVersion,
              size: 88,
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.tonal(onPressed: _pickPhoto, child: const Text('Change photo')),
          const SizedBox(height: 16),
          TextField(controller: _display, decoration: const InputDecoration(labelText: 'Display name')),
          const SizedBox(height: 12),
          TextField(controller: _full, decoration: const InputDecoration(labelText: 'Full name')),
          const SizedBox(height: 12),
          TextField(controller: _email, decoration: const InputDecoration(labelText: 'Email')),
          const SizedBox(height: 12),
          TextField(controller: _phone, decoration: const InputDecoration(labelText: 'Phone')),
          const SizedBox(height: 12),
          TextField(controller: _address, decoration: const InputDecoration(labelText: 'Address')),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy
                ? null
                : () async {
                    setState(() => _busy = true);
                    await ref.read(apiClientProvider).patch('/api/v1/users/me', data: {
                      'displayName': _display.text.trim(),
                      'fullName': _full.text.trim(),
                      if (_email.text.trim().isNotEmpty) 'email': _email.text.trim(),
                      if (_phone.text.trim().isNotEmpty) 'phone': _phone.text.trim(),
                      if (_address.text.trim().isNotEmpty) 'address': _address.text.trim(),
                    });
                    await ref.read(authControllerProvider.notifier).refreshProfile();
                    if (mounted) setState(() => _busy = false);
                  },
            child: Text(_busy ? 'Saving…' : 'Save'),
          ),
        ],
      ),
    );
  }

  Future<void> _pickPhoto() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 1600);
    if (picked == null) return;
    final media = await prepareImage(path: picked.path, fileName: picked.name, mimeType: picked.mimeType);
    final init = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
      '/api/v1/users/me/photo',
      data: {'mimeType': media.mimeType},
    );
    await ref.read(apiClientProvider).putFileRange(
      init['uploadUrl'] as String,
      File(media.path),
      start: 0,
      end: media.sizeBytes,
      headers: (init['headers'] as Map?)?.map((key, value) => MapEntry(key.toString(), value.toString())),
    );
    await ref.read(apiClientProvider).post('/api/v1/users/me/photo/complete', data: {
      'key': init['key'],
      'mimeType': media.mimeType,
    });
    await ref.read(authControllerProvider.notifier).refreshProfile();
  }
}

class DevicesScreen extends ConsumerStatefulWidget {
  const DevicesScreen({super.key});

  @override
  ConsumerState<DevicesScreen> createState() => _DevicesScreenState();
}

class _DevicesScreenState extends ConsumerState<DevicesScreen> {
  List<Map<String, dynamic>> _sessions = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final data = await ref.read(apiClientProvider).get<dynamic>('/api/v1/sessions');
    final rows = data is List ? data : (data as Map)['data'] as List? ?? [];
    setState(() => _sessions = rows.cast<Map>().map(Map<String, dynamic>.from).toList());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Devices')),
      body: ListView(
        children: [
          for (final session in _sessions)
            ListTile(
              title: Text(session['deviceName'] as String? ?? 'Device'),
              subtitle: Text('${session['platform'] ?? ''} · ${session['createdAt'] ?? ''}'),
              trailing: IconButton(
                onPressed: () async {
                  await ref.read(apiClientProvider).delete('/api/v1/sessions/${session['id']}');
                  await _load();
                },
                icon: const Icon(Icons.logout),
              ),
            ),
        ],
      ),
    );
  }
}

class NotificationSettingsScreen extends ConsumerStatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  ConsumerState<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends ConsumerState<NotificationSettingsScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(notificationPrefsProvider.notifier).load());
  }

  @override
  Widget build(BuildContext context) {
    final prefs = ref.watch(notificationPrefsProvider);
    final controller = ref.read(notificationPrefsProvider.notifier);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: ListView(
        children: [
          SwitchListTile(
            title: const Text('Message notifications'),
            subtitle: const Text('Incoming direct and group messages'),
            value: prefs.messagesEnabled,
            onChanged: (value) => controller.update(prefs.copyWith(messagesEnabled: value)),
          ),
          SwitchListTile(
            title: const Text('Notification sound'),
            value: prefs.sound,
            onChanged: prefs.messagesEnabled ? (value) => controller.update(prefs.copyWith(sound: value)) : null,
          ),
          SwitchListTile(
            title: const Text('Vibration'),
            subtitle: const Text('Used when the system channel allows it'),
            value: prefs.vibration,
            onChanged: prefs.messagesEnabled ? (value) => controller.update(prefs.copyWith(vibration: value)) : null,
          ),
          SwitchListTile(
            title: const Text('Message preview'),
            subtitle: const Text('Show sender names and message text'),
            value: prefs.showPreview,
            onChanged: (value) => controller.update(prefs.copyWith(showPreview: value)),
          ),
          SwitchListTile(
            title: const Text('Show sender on lock screen'),
            subtitle: const Text('When the operating system allows public notifications'),
            value: prefs.showSenderOnLockScreen,
            onChanged: (value) => controller.update(prefs.copyWith(showSenderOnLockScreen: value)),
          ),
          SwitchListTile(
            title: const Text('Group notifications'),
            subtitle: const Text('Collapse multiple messages from the same chat'),
            value: prefs.groupNotifications,
            onChanged: (value) => controller.update(prefs.copyWith(groupNotifications: value)),
          ),
          SwitchListTile(
            title: const Text('Retention reminders'),
            subtitle: const Text('Reminders before 90-day chat cleanup'),
            value: prefs.retentionReminders,
            onChanged: (value) => controller.update(prefs.copyWith(retentionReminders: value)),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 12, 16, 24),
            child: Text(
              'System notification permission, Focus, and Do Not Disturb still apply. Mute a chat from that conversation to silence it on every device.',
              style: TextStyle(color: AppColors.mutedForeground, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}
