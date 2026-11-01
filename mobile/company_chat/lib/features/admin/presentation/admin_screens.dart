import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/widgets/user_avatar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class AdminScreen extends ConsumerStatefulWidget {
  const AdminScreen({super.key});

  @override
  ConsumerState<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends ConsumerState<AdminScreen> with SingleTickerProviderStateMixin {
  late final _tabs = TabController(length: 3, vsync: this);
  List<Map<String, dynamic>> _users = [];
  List<Map<String, dynamic>> _audit = [];
  Map<String, dynamic>? _retention;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _loadUsers();
    _loadAudit();
    _loadRetention();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    try {
      final data = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
        '/api/v1/admin/users',
        query: {'search': _query, 'limit': 50, 'page': 1},
      );
      if (!mounted) return;
      setState(() {
        _users = ((data['data'] as List?) ?? []).cast<Map>().map(Map<String, dynamic>.from).toList();
      });
    } catch (_) {}
  }

  Future<void> _loadAudit() async {
    try {
      final data = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
        '/api/v1/admin/audit-logs',
        query: {'limit': 50, 'page': 1},
      );
      if (!mounted) return;
      setState(() {
        _audit = ((data['data'] as List?) ?? []).cast<Map>().map(Map<String, dynamic>.from).toList();
      });
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Admin'),
        bottom: TabBar(
          controller: _tabs,
          tabs: const [Tab(text: 'Employees'), Tab(text: 'Audit'), Tab(text: 'Retention')],
        ),
        actions: [
          IconButton(
            onPressed: () => _createEmployee(context),
            icon: const Icon(Icons.person_add_alt_1),
          ),
        ],
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: TextField(
                  onChanged: (value) {
                    _query = value;
                    _loadUsers();
                  },
                  decoration: const InputDecoration(hintText: 'Search employees', prefixIcon: Icon(Icons.search)),
                ),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: _users.length,
                  itemBuilder: (context, index) {
                    final user = _users[index];
                    return ListTile(
                      leading: UserAvatar(person: user),
                      title: Text(user['displayName'] as String? ?? ''),
                      subtitle: Text('@${user['username']} · ${user['status']} · ${user['role']}'),
                      onTap: () => _editEmployee(context, user),
                      trailing: PopupMenuButton<String>(
                        onSelected: (value) => _act(user, value),
                        itemBuilder: (_) => [
                          const PopupMenuItem(value: 'edit', child: Text('Edit details')),
                          const PopupMenuItem(value: 'suspend', child: Text('Suspend')),
                          const PopupMenuItem(value: 'reactivate', child: Text('Reactivate')),
                          const PopupMenuItem(value: 'reset', child: Text('Reset password')),
                          const PopupMenuItem(value: 'revoke', child: Text('Revoke sessions')),
                          const PopupMenuItem(value: 'delete', child: Text('Delete')),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
          ListView.builder(
            itemCount: _audit.length,
            itemBuilder: (context, index) {
              final row = _audit[index];
              return ListTile(
                title: Text(row['action'] as String? ?? ''),
                subtitle: Text('${row['targetType'] ?? ''} · ${row['createdAt'] ?? ''}'),
              );
            },
          ),
          _RetentionPane(
            report: _retention,
            onRefresh: _loadRetention,
            onDays: (days) => _patchRetention({'retentionDays': days}),
            onReminders: (enabled) => _patchRetention({'remindersEnabled': enabled}),
            onActivate: _activateRetention,
            onPause: _pauseRetention,
          ),
        ],
      ),
    );
  }

  Future<void> _act(Map<String, dynamic> user, String action) async {
    final id = user['id'];
    final api = ref.read(apiClientProvider);
    if (action == 'edit') {
      await _editEmployee(context, user);
      return;
    }
    if (action == 'suspend') await api.post('/api/v1/admin/users/$id/suspend');
    if (action == 'reactivate') await api.post('/api/v1/admin/users/$id/reactivate');
    if (action == 'reset') {
      final result = await api.post<Map<String, dynamic>>('/api/v1/admin/users/$id/reset-password');
      if (mounted) {
        await showDialog<void>(
          context: context,
          builder: (_) => AlertDialog(
            title: const Text('Temporary password'),
            content: SelectableText(result['temporaryPassword'] as String? ?? ''),
            actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Done'))],
          ),
        );
      }
    }
    if (action == 'revoke') await api.delete('/api/v1/admin/users/$id/sessions');
    if (action == 'delete') await api.delete('/api/v1/admin/users/$id');
    await _loadUsers();
    await _loadAudit();
  }

  Future<void> _editEmployee(BuildContext context, Map<String, dynamic> user) async {
    final display = TextEditingController(text: user['displayName'] as String? ?? '');
    final full = TextEditingController(text: user['fullName'] as String? ?? '');
    final email = TextEditingController(text: user['email'] as String? ?? '');
    final phone = TextEditingController(text: user['phoneE164'] as String? ?? '');
    final address = TextEditingController(text: user['address'] as String? ?? '');
    var role = user['role'] as String? ?? 'user';
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialog) => AlertDialog(
          title: Text('Edit ${user['username']}'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: display, decoration: const InputDecoration(labelText: 'Display name')),
                const SizedBox(height: 8),
                TextField(controller: full, decoration: const InputDecoration(labelText: 'Full name')),
                const SizedBox(height: 8),
                TextField(controller: email, decoration: const InputDecoration(labelText: 'Email')),
                const SizedBox(height: 8),
                TextField(controller: phone, decoration: const InputDecoration(labelText: 'Phone')),
                const SizedBox(height: 8),
                TextField(controller: address, decoration: const InputDecoration(labelText: 'Address')),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: role,
                  items: const [
                    DropdownMenuItem(value: 'user', child: Text('User')),
                    DropdownMenuItem(value: 'admin', child: Text('Admin')),
                  ],
                  onChanged: (value) => setDialog(() => role = value ?? 'user'),
                  decoration: const InputDecoration(labelText: 'Role'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
            FilledButton(
              onPressed: () async {
                await ref.read(apiClientProvider).patch(
                  '/api/v1/admin/users/${user['id']}',
                  data: {
                    'displayName': display.text.trim(),
                    if (full.text.trim().isNotEmpty) 'fullName': full.text.trim(),
                    if (email.text.trim().isNotEmpty) 'email': email.text.trim(),
                    if (phone.text.trim().isNotEmpty) 'phone': phone.text.trim(),
                    if (address.text.trim().isNotEmpty) 'address': address.text.trim(),
                    'role': role,
                  },
                );
                if (!dialogContext.mounted) return;
                Navigator.pop(dialogContext);
                await _loadUsers();
                await _loadAudit();
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    display.dispose();
    full.dispose();
    email.dispose();
    phone.dispose();
    address.dispose();
  }

  Future<void> _createEmployee(BuildContext context) async {
    final username = TextEditingController();
    final display = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('New employee'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: username, decoration: const InputDecoration(labelText: 'Username')),
            TextField(controller: display, decoration: const InputDecoration(labelText: 'Display name')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              final created = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
                '/api/v1/admin/users',
                data: {
                  'username': username.text.trim(),
                  'displayName': display.text.trim(),
                },
              );
              if (!dialogContext.mounted) return;
              Navigator.pop(dialogContext);
              if (!context.mounted) return;
              await showDialog<void>(
                context: context,
                builder: (_) => AlertDialog(
                  title: const Text('Temporary password'),
                  content: SelectableText(
                    created['temporaryPassword'] as String? ?? '',
                    style: const TextStyle(color: AppColors.goldForeground),
                  ),
                ),
              );
              await _loadUsers();
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
  }

  Future<void> _loadRetention() async {
    try {
      final data = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/api/v1/admin/retention');
      if (!mounted) return;
      setState(() => _retention = data);
    } catch (_) {}
  }

  Future<void> _patchRetention(Map<String, dynamic> body) async {
    await ref.read(apiClientProvider).patch('/api/v1/admin/retention', data: body);
    await _loadRetention();
  }

  Future<void> _activateRetention() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Approve scheduled deletion'),
        content: const Text(
          'Expired chat messages and media will be permanently removed. This cannot be undone in the app.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Activate')),
        ],
      ),
    );
    if (ok != true) return;
    await ref.read(apiClientProvider).post('/api/v1/admin/retention/activate');
    await _loadRetention();
  }

  Future<void> _pauseRetention() async {
    await ref.read(apiClientProvider).post('/api/v1/admin/retention/pause');
    await _loadRetention();
  }
}

class _RetentionPane extends StatelessWidget {
  const _RetentionPane({
    required this.report,
    required this.onRefresh,
    required this.onDays,
    required this.onReminders,
    required this.onActivate,
    required this.onPause,
  });

  final Map<String, dynamic>? report;
  final Future<void> Function() onRefresh;
  final Future<void> Function(int days) onDays;
  final Future<void> Function(bool enabled) onReminders;
  final Future<void> Function() onActivate;
  final Future<void> Function() onPause;

  @override
  Widget build(BuildContext context) {
    final policy = (report?['policy'] as Map?)?.cast<String, dynamic>();
    final preview = (report?['preview'] as Map?)?.cast<String, dynamic>();
    final jobs = ((report?['jobs'] as List?) ?? []).cast<Map>().map(Map<String, dynamic>.from).toList();
    final days = policy?['retentionDays'] as int? ?? 90;
    final active = policy?['cleanupEnabled'] == true;
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Chat retention', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          const Text(
            'Messages expire from the original send time. Accounts, groups, and profile photos are never deleted.',
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            children: [30, 90, 180]
                .map(
                  (value) => ChoiceChip(
                    label: Text('$value days'),
                    selected: days == value,
                    onSelected: (_) => onDays(value),
                  ),
                )
                .toList(),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Advance reminders'),
            subtitle: const Text('Notify 30, 7, and 1 day before expiry'),
            value: policy?['remindersEnabled'] != false,
            onChanged: onReminders,
          ),
          Text(
            active
                ? 'Cleanup is active'
                : 'Preview / dry-run mode. ${preview?['eligibleMessages'] ?? 0} messages would be removed if approved.',
          ),
          const SizedBox(height: 12),
          if (active)
            OutlinedButton(onPressed: onPause, child: const Text('Pause scheduled deletion'))
          else
            FilledButton(onPressed: onActivate, child: const Text('Approve first destructive cleanup')),
          const SizedBox(height: 16),
          Text('Recent jobs', style: Theme.of(context).textTheme.titleSmall),
          ...jobs.map(
            (job) => ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('${job['kind']} · ${job['status']}'),
              subtitle: Text('${job['lastError'] ?? job['finishedAt'] ?? job['createdAt'] ?? ''}'),
            ),
          ),
        ],
      ),
    );
  }
}
