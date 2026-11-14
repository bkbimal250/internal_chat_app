import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/widgets/empty_state.dart';
import 'package:company_chat/core/widgets/user_avatar.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class ContactsScreen extends ConsumerStatefulWidget {
  const ContactsScreen({super.key});

  @override
  ConsumerState<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends ConsumerState<ContactsScreen> {
  List<Map<String, dynamic>> _people = [];
  String _query = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final data = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
      '/api/v1/users',
      query: {'search': _query, 'limit': 50, 'page': 1},
    );
    if (!mounted) return;
    final me = ref.read(authControllerProvider).user?.id;
    setState(() {
      _people = ((data['data'] as List?) ?? [])
          .cast<Map>()
          .map(Map<String, dynamic>.from)
          .where((row) => row['id'] != me)
          .toList();
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('People')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              onChanged: (value) {
                _query = value;
                _load();
              },
              decoration: const InputDecoration(hintText: 'Search employees', prefixIcon: Icon(Icons.search)),
            ),
          ),
          Expanded(
            child: _loading
                ? const LoadingState(label: 'Loading people…')
                : _people.isEmpty
                    ? const EmptyState(
                        icon: Icons.people_outline,
                        title: 'No colleagues found',
                        description: 'Try a different search.',
                      )
                    : ListView.separated(
                        itemCount: _people.length,
                        separatorBuilder: (_, _) => const Divider(indent: 76, endIndent: 16),
                        itemBuilder: (context, index) {
                          final person = _people[index];
                          return ListTile(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                            leading: UserAvatar(person: person, size: AppSpacing.avatar),
                            title: Text(
                              person['displayName'] as String? ?? '',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            subtitle: Text('@${person['username']}', maxLines: 1, overflow: TextOverflow.ellipsis),
                            onTap: () async {
                              final chat = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
                                '/api/v1/conversations/direct',
                                data: {'userId': person['id']},
                              );
                              if (!context.mounted) return;
                              context.push('/chats/${chat['id']}');
                            },
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}
