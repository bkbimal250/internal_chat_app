import 'dart:io';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/widgets/empty_state.dart';
import 'package:company_chat/core/widgets/user_avatar.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/media/media_prepare.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

class GroupsScreen extends ConsumerStatefulWidget {
  const GroupsScreen({super.key});

  @override
  ConsumerState<GroupsScreen> createState() => _GroupsScreenState();
}

class _GroupsScreenState extends ConsumerState<GroupsScreen> {
  List<Map<String, dynamic>> _groups = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final data = await ref.read(apiClientProvider).get<dynamic>('/api/v1/groups');
    final rows = data is List ? data : (data as Map)['data'] as List? ?? [];
    setState(() {
      _groups = rows.cast<Map>().map(Map<String, dynamic>.from).toList();
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Groups')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/groups/create'),
        child: const Icon(Icons.add),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _groups.isEmpty
              ? const EmptyState(icon: Icons.groups_outlined, title: 'No groups yet')
              : ListView.builder(
                  itemCount: _groups.length,
                  itemBuilder: (context, index) {
                    final group = _groups[index];
                    return ListTile(
                      leading: UserAvatar(
                        name: group['title'] as String?,
                        userId: group['id'] as String?,
                        hasPhoto: group['hasAvatar'] == true,
                        photoVersion: group['avatarVersion']?.toString(),
                        group: true,
                      ),
                      title: Text(group['title'] as String? ?? 'Untitled group'),
                      subtitle: Text(group['description'] as String? ?? 'Group conversation'),
                      onTap: () => context.push('/chats/${group['id']}'),
                    );
                  },
                ),
    );
  }
}

class CreateGroupScreen extends ConsumerStatefulWidget {
  const CreateGroupScreen({super.key});

  @override
  ConsumerState<CreateGroupScreen> createState() => _CreateGroupScreenState();
}

class _CreateGroupScreenState extends ConsumerState<CreateGroupScreen> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _selected = <String>{};
  List<Map<String, dynamic>> _people = [];
  File? _photo;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final directory = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/api/v1/users', query: {'limit': 100});
    if (!mounted) return;
    setState(() {
      _people = ((directory['data'] as List?) ?? []).cast<Map>().map(Map<String, dynamic>.from).toList();
    });
  }

  Future<void> _pickPhoto() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 1600);
    if (picked == null) return;
    setState(() => _photo = File(picked.path));
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authControllerProvider).user?.id;
    return Scaffold(
      appBar: AppBar(title: const Text('Create group')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            GestureDetector(
              onTap: _pickPhoto,
              child: CircleAvatar(
                radius: 36,
                backgroundColor: AppColors.sidebarAccent,
                backgroundImage: _photo == null ? null : FileImage(_photo!),
                child: _photo == null ? const Icon(Icons.camera_alt, color: AppColors.gold) : null,
              ),
            ),
            const SizedBox(height: 16),
            TextField(controller: _title, decoration: const InputDecoration(labelText: 'Group name')),
            const SizedBox(height: 12),
            TextField(controller: _description, decoration: const InputDecoration(labelText: 'Description (optional)')),
            const SizedBox(height: 16),
            const Align(
              alignment: Alignment.centerLeft,
              child: Text('Select members', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
            Expanded(
              child: ListView(
                children: [
                  for (final person in _people.where((row) => row['id'] != me))
                    CheckboxListTile(
                      value: _selected.contains(person['id']),
                      title: Text(person['displayName'] as String? ?? ''),
                      secondary: UserAvatar(person: person),
                      onChanged: (value) {
                        setState(() {
                          if (value == true) {
                            _selected.add(person['id'] as String);
                          } else {
                            _selected.remove(person['id']);
                          }
                        });
                      },
                    ),
                ],
              ),
            ),
            FilledButton(
              onPressed: _busy
                  ? null
                  : () async {
                      setState(() => _busy = true);
                      final created = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
                        '/api/v1/groups',
                        data: {
                          'title': _title.text.trim(),
                          if (_description.text.trim().isNotEmpty) 'description': _description.text.trim(),
                        },
                      );
                      if (_photo != null) {
                        final media = await prepareImage(path: _photo!.path, fileName: 'group.jpg', mimeType: 'image/jpeg');
                        final init = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
                          '/api/v1/groups/${created['id']}/photo',
                          data: {'mimeType': media.mimeType},
                        );
                        await ref.read(apiClientProvider).putFileRange(
                          init['uploadUrl'] as String,
                          File(media.path),
                          start: 0,
                          end: media.sizeBytes,
                          headers: (init['headers'] as Map?)?.map((key, value) => MapEntry(key.toString(), value.toString())),
                        );
                        await ref.read(apiClientProvider).post('/api/v1/groups/${created['id']}/photo/complete', data: {
                          'key': init['key'],
                          'mimeType': media.mimeType,
                        });
                      }
                      for (final userId in _selected) {
                        await ref.read(apiClientProvider).post(
                          '/api/v1/groups/${created['id']}/members',
                          data: {'userId': userId},
                        );
                      }
                      if (!context.mounted) return;
                      context.go('/chats/${created['id']}');
                    },
              child: Text(_busy ? 'Creating…' : 'Create group'),
            ),
          ],
        ),
      ),
    );
  }
}

class GroupInfoScreen extends ConsumerStatefulWidget {
  const GroupInfoScreen({super.key, required this.groupId});

  final String groupId;

  @override
  ConsumerState<GroupInfoScreen> createState() => _GroupInfoScreenState();
}

class _GroupInfoScreenState extends ConsumerState<GroupInfoScreen> {
  Map<String, dynamic>? _group;
  List<Map<String, dynamic>> _people = [];
  String _query = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final group = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/api/v1/groups/${widget.groupId}');
    final directory = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/api/v1/users', query: {'limit': 50});
    setState(() {
      _group = group;
      _people = ((directory['data'] as List?) ?? []).cast<Map>().map(Map<String, dynamic>.from).toList();
    });
  }

  Map<String, dynamic> get _settings => (_group?['settings'] as Map?)?.cast<String, dynamic>() ?? {};

  bool _canEdit(String? role) {
    if (role == 'owner') return true;
    return _settings['editInfo'] == 'all' ? role == 'admin' || role == 'member' : role == 'admin';
  }

  bool _canAdd(String? role) {
    if (role == 'owner') return true;
    return _settings['addMembers'] == 'all' ? role == 'admin' || role == 'member' : role == 'admin';
  }

  Future<void> _confirm(String title, Future<void> Function() action) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Confirm')),
        ],
      ),
    );
    if (ok == true) await action();
  }

  Future<void> _editInfo() async {
    final title = TextEditingController(text: _group?['title'] as String? ?? '');
    final description = TextEditingController(text: _group?['description'] as String? ?? '');
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit group info'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: title, decoration: const InputDecoration(labelText: 'Name')),
            TextField(controller: description, decoration: const InputDecoration(labelText: 'Description')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Save')),
        ],
      ),
    );
    if (saved == true) {
      await ref.read(apiClientProvider).patch('/api/v1/groups/${widget.groupId}', data: {
        'title': title.text.trim(),
        'description': description.text.trim(),
      });
      await _load();
    }
  }

  Future<void> _permissions() async {
    var editInfo = _settings['editInfo'] == 'all' ? 'all' : 'admins';
    var sendMessages = _settings['sendMessages'] == 'admins' ? 'admins' : 'all';
    var addMembers = _settings['addMembers'] == 'all' ? 'all' : 'admins';
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Group permissions'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _PolicyTile('Edit group info', editInfo, (value) => setLocal(() => editInfo = value)),
              _PolicyTile('Send messages', sendMessages, (value) => setLocal(() => sendMessages = value)),
              _PolicyTile('Add members', addMembers, (value) => setLocal(() => addMembers = value)),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Save')),
          ],
        ),
      ),
    );
    if (saved == true) {
      await ref.read(apiClientProvider).patch('/api/v1/groups/${widget.groupId}/settings', data: {
        'editInfo': editInfo,
        'sendMessages': sendMessages,
        'addMembers': addMembers,
      });
      await _load();
    }
  }

  Future<void> _changePhoto() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 1600);
    if (picked == null) return;
    final media = await prepareImage(path: picked.path, fileName: picked.name, mimeType: picked.mimeType);
    final init = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
      '/api/v1/groups/${widget.groupId}/photo',
      data: {'mimeType': media.mimeType},
    );
    await ref.read(apiClientProvider).putFileRange(
      init['uploadUrl'] as String,
      File(media.path),
      start: 0,
      end: media.sizeBytes,
      headers: (init['headers'] as Map?)?.map((key, value) => MapEntry(key.toString(), value.toString())),
    );
    await ref.read(apiClientProvider).post('/api/v1/groups/${widget.groupId}/photo/complete', data: {
      'key': init['key'],
      'mimeType': media.mimeType,
    });
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authControllerProvider).user;
    final members = ((_group?['members'] as List?) ?? []).cast<Map>().map(Map<String, dynamic>.from).toList();
    final myRole = members.firstWhere((row) => row['id'] == me?.id, orElse: () => {})['role'] as String?;
    final canEdit = _canEdit(myRole);
    final canAdd = _canAdd(myRole);
    final visible = members.where((member) {
      if (_query.trim().isEmpty) return true;
      return '${member['displayName'] ?? ''} ${member['fullName'] ?? ''}'.toLowerCase().contains(_query.toLowerCase());
    }).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Group info')),
      body: _group == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                const SizedBox(height: 24),
                Center(
                  child: UserAvatar(
                    name: _group?['title'] as String?,
                    userId: widget.groupId,
                    hasPhoto: _group?['hasAvatar'] == true,
                    photoVersion: _group?['avatarVersion']?.toString(),
                    group: true,
                    size: 96,
                  ),
                ),
                if (canEdit)
                  TextButton(onPressed: _changePhoto, child: const Text('Change photo')),
                ListTile(
                  title: Text(_group?['title'] as String? ?? 'Group', textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                  subtitle: Text(
                    'Group · ${members.length} participants',
                    textAlign: TextAlign.center,
                  ),
                ),
                if ((_group?['createdAt'] as String?) != null)
                  Text(
                    'Created ${_group!['createdAt']}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: AppColors.mutedForeground, fontSize: 12),
                  ),
                ListTile(
                  title: const Text('Description'),
                  subtitle: Text(_group?['description'] as String? ?? 'No description'),
                  trailing: canEdit ? IconButton(onPressed: _editInfo, icon: const Icon(Icons.edit_outlined)) : null,
                ),
                if (myRole == 'owner')
                  ListTile(
                    leading: const Icon(Icons.tune, color: AppColors.gold),
                    title: const Text('Group permissions'),
                    subtitle: const Text('Info, messaging, and adding members'),
                    onTap: _permissions,
                  ),
                const Divider(),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                  child: TextField(
                    decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search participants'),
                    onChanged: (value) => setState(() => _query = value),
                  ),
                ),
                for (final member in visible)
                  ListTile(
                    leading: UserAvatar(person: member, online: ref.watch(onlineUsersProvider).contains(member['id'])),
                    title: Text('${member['fullName'] ?? member['displayName'] ?? ''}${member['id'] == me?.id ? ' (You)' : ''}'),
                    subtitle: Text((member['role'] as String? ?? 'member').toUpperCase()),
                    trailing: member['id'] == me?.id
                        ? null
                        : PopupMenuButton<String>(
                            onSelected: (value) async {
                              if (value == 'profile') {
                                if (!context.mounted) return;
                                await showDialog<void>(
                                  context: context,
                                  builder: (context) => AlertDialog(
                                    title: const Text('Participant'),
                                    content: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        UserAvatar(person: member, size: 72),
                                        const SizedBox(height: 12),
                                        Text(
                                          '${member['fullName'] ?? member['displayName'] ?? ''}',
                                          style: const TextStyle(fontWeight: FontWeight.w700),
                                        ),
                                        Text('@${member['username'] ?? ''}'),
                                        Text((member['role'] as String? ?? 'member').toUpperCase()),
                                      ],
                                    ),
                                  ),
                                );
                              }
                              if (value == 'message') {
                                final chat = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
                                  '/api/v1/conversations/direct',
                                  data: {'userId': member['id']},
                                );
                                if (context.mounted) context.push('/chats/${chat['id']}');
                              }
                              if (value == 'admin') {
                                await ref.read(apiClientProvider).patch(
                                  '/api/v1/groups/${widget.groupId}/members/${member['id']}/role',
                                  data: {'role': 'admin'},
                                );
                                await _load();
                              }
                              if (value == 'member') {
                                await ref.read(apiClientProvider).patch(
                                  '/api/v1/groups/${widget.groupId}/members/${member['id']}/role',
                                  data: {'role': 'member'},
                                );
                                await _load();
                              }
                              if (value == 'owner') {
                                await _confirm('Transfer group ownership?', () async {
                                  await ref.read(apiClientProvider).post(
                                    '/api/v1/groups/${widget.groupId}/transfer-owner',
                                    data: {'userId': member['id']},
                                  );
                                  await _load();
                                });
                              }
                              if (value == 'remove') {
                                await _confirm('Remove this member?', () async {
                                  await ref.read(apiClientProvider).delete('/api/v1/groups/${widget.groupId}/members/${member['id']}');
                                  await _load();
                                });
                              }
                            },
                            itemBuilder: (_) => [
                              const PopupMenuItem(value: 'profile', child: Text('View profile')),
                              const PopupMenuItem(value: 'message', child: Text('Message participant')),
                              if (myRole == 'owner' && member['role'] != 'owner')
                                PopupMenuItem(
                                  value: member['role'] == 'admin' ? 'member' : 'admin',
                                  child: Text(member['role'] == 'admin' ? 'Dismiss as admin' : 'Make group admin'),
                                ),
                              if (myRole == 'owner' && member['role'] != 'owner')
                                const PopupMenuItem(value: 'owner', child: Text('Transfer ownership')),
                              if ((myRole == 'owner' && member['role'] != 'owner') ||
                                  (myRole == 'admin' && member['role'] == 'member'))
                                const PopupMenuItem(value: 'remove', child: Text('Remove from group')),
                            ],
                          ),
                  ),
                if (canAdd) ...[
                  const Divider(),
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('Add participants', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                  for (final person in _people.where((row) => members.every((member) => member['id'] != row['id'])))
                    ListTile(
                      leading: UserAvatar(person: person),
                      title: Text(person['displayName'] as String? ?? ''),
                      trailing: IconButton(
                        onPressed: () async {
                          await ref.read(apiClientProvider).post('/api/v1/groups/${widget.groupId}/members', data: {'userId': person['id']});
                          await _load();
                        },
                        icon: const Icon(Icons.person_add_alt),
                      ),
                    ),
                ],
                if (myRole != 'owner')
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: OutlinedButton(
                      onPressed: () => _confirm('Leave this group?', () async {
                        await ref.read(apiClientProvider).post('/api/v1/groups/${widget.groupId}/leave');
                        if (context.mounted) context.go('/chats');
                      }),
                      child: const Text('Leave group'),
                    ),
                  ),
              ],
            ),
    );
  }
}

class _PolicyTile extends StatelessWidget {
  const _PolicyTile(this.label, this.value, this.onChanged);

  final String label;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
        RadioGroup<String>(
          groupValue: value,
          onChanged: (next) {
            if (next != null) onChanged(next);
          },
          child: const Column(
            children: [
              RadioListTile<String>(value: 'all', title: Text('All members'), dense: true),
              RadioListTile<String>(value: 'admins', title: Text('Admins only'), dense: true),
            ],
          ),
        ),
      ],
    );
  }
}
