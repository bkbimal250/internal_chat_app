import 'package:cached_network_image/cached_network_image.dart';
import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/network/public_url.dart';
import 'package:company_chat/core/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final signedPhotoUrlProvider = FutureProvider.autoDispose.family<String?, String>((ref, key) async {
  final parts = key.split('|');
  final userId = parts.first;
  if (userId.isEmpty) return null;
  final kind = parts.length > 2 ? parts[2] : 'user';
  try {
    final path = kind == 'group' ? '/api/v1/groups/$userId/photo-url' : '/api/v1/users/$userId/photo-url';
    final data = await ref.read(apiClientProvider).get<Map<String, dynamic>>(path);
    final url = data['url'] as String?;
    if (url == null || url.isEmpty) return null;
    return rewritePublicUrl(url);
  } catch (_) {
    return null;
  }
});

class UserAvatar extends ConsumerWidget {
  const UserAvatar({
    super.key,
    this.person,
    this.name,
    this.url,
    this.userId,
    this.hasPhoto,
    this.photoVersion,
    this.size = 44,
    this.group = false,
    this.online = false,
  });

  final Map<String, dynamic>? person;
  final String? name;
  final String? url;
  final String? userId;
  final bool? hasPhoto;
  final String? photoVersion;
  final double size;
  final bool group;
  final bool online;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final resolvedName = name ?? person?['displayName'] as String? ?? (group ? 'Group' : '?');
    final id = userId ?? person?['id'] as String?;
    final version = photoVersion ?? person?['photoVersion']?.toString() ?? person?['updatedAt']?.toString() ?? '';
    final direct = url ?? person?['profilePhotoUrl'] as String?;
    final flagged = hasPhoto ??
        (person?['hasProfilePhoto'] == true ||
            person?['hasAvatar'] == true ||
            (person?['profilePhotoKey'] is String && (person!['profilePhotoKey'] as String).isNotEmpty));
    final rewritten = direct == null || direct.isEmpty ? null : rewritePublicUrl(direct);
    final shouldFetch = rewritten == null && flagged && id != null;
    final fetched = shouldFetch
        ? ref.watch(signedPhotoUrlProvider('$id|$version|${group ? 'group' : 'user'}'))
        : null;
    final imageUrl = rewritten ?? fetched?.valueOrNull;
    final loading = shouldFetch && (fetched?.isLoading ?? false);

    return Stack(
      children: [
        CircleAvatar(
          radius: size / 2,
          backgroundColor: group ? AppColors.sidebarAccent : AppColors.muted,
          foregroundColor: group ? AppColors.gold : AppColors.foreground,
          child: imageUrl == null
              ? (loading
                    ? SizedBox(
                        width: size * 0.36,
                        height: size * 0.36,
                        child: const CircularProgressIndicator(strokeWidth: 2),
                      )
                    : group
                        ? Icon(Icons.groups, size: size * 0.48, color: AppColors.gold)
                        : Text(
                            _initials(resolvedName),
                            style: TextStyle(fontWeight: FontWeight.w600, fontSize: size * 0.32),
                          ))
              : ClipOval(
                  child: CachedNetworkImage(
                    imageUrl: imageUrl,
                    width: size,
                    height: size,
                    fit: BoxFit.cover,
                    fadeInDuration: const Duration(milliseconds: 180),
                    placeholder: (_, _) => ColoredBox(color: AppColors.muted),
                    errorWidget: (_, _, _) => Center(
                      child: Text(
                        _initials(resolvedName),
                        style: TextStyle(fontWeight: FontWeight.w600, fontSize: size * 0.32),
                      ),
                    ),
                  ),
                ),
        ),
        if (online)
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: size * 0.28,
              height: size * 0.28,
              decoration: BoxDecoration(
                color: AppColors.unread,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.card, width: 2),
              ),
            ),
          ),
      ],
    );
  }

  String _initials(String value) {
    final parts = value.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
  }
}
