import 'package:flutter_cache_manager/flutter_cache_manager.dart';

class MiChatMediaCache {
  MiChatMediaCache({CacheManager? avatars, CacheManager? thumbs})
      : avatars = avatars ??
            CacheManager(
              Config(
                'michat_avatars',
                stalePeriod: const Duration(days: 14),
                maxNrOfCacheObjects: 200,
              ),
            ),
        thumbs = thumbs ??
            CacheManager(
              Config(
                'michat_thumbs',
                stalePeriod: const Duration(days: 7),
                maxNrOfCacheObjects: 300,
              ),
            );

  final CacheManager avatars;
  final CacheManager thumbs;

  Future<void> clear() async {
    await avatars.emptyCache();
    await thumbs.emptyCache();
  }
}

MiChatMediaCache? _miChatMediaCache;
MiChatMediaCache get miChatMediaCache => _miChatMediaCache ??= MiChatMediaCache();

Future<void> clearMediaCache() async {
  final cache = _miChatMediaCache;
  if (cache == null) return;
  await cache.clear();
}

String? avatarCacheKey({required String? id, String? version, bool group = false}) {
  if (id == null || id.isEmpty) return null;
  return 'avatar:${group ? 'g' : 'u'}:$id:${version ?? ''}';
}

String? thumbCacheKey(String? attachmentId) {
  if (attachmentId == null || attachmentId.isEmpty) return null;
  return 'thumb:$attachmentId';
}
