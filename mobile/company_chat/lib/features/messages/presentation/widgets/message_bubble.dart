import 'package:cached_network_image/cached_network_image.dart';
import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/network/public_url.dart';
import 'package:company_chat/core/storage/media_cache.dart';
import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/utils/preview_text.dart';
import 'package:company_chat/core/utils/time_format.dart';
import 'package:company_chat/features/media/media_batch.dart';
import 'package:company_chat/features/media/media_download.dart';
import 'package:company_chat/features/media/media_limits.dart';
import 'package:company_chat/features/messages/presentation/widgets/reply_preview.dart';
import 'package:company_chat/features/messages/presentation/widgets/swipe_to_reply.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:photo_view/photo_view.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.message,
    required this.previous,
    required this.currentUserId,
    required this.isGroup,
    required this.members,
    required this.onReply,
    required this.onLongPress,
    this.selected = false,
    this.selectionMode = false,
    this.onTap,
  });

  final Map<String, dynamic> message;
  final Map<String, dynamic>? previous;
  final String? currentUserId;
  final bool isGroup;
  final List<dynamic> members;
  final VoidCallback onReply;
  final VoidCallback onLongPress;
  final bool selected;
  final bool selectionMode;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final mine = message['senderId'] == currentUserId;
    final showDay = !sameDay(previous?['createdAt'], message['createdAt']);
    if (message['messageType'] == 'system') {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 24),
        child: Center(
          child: Text(
            message['content'] as String? ?? '',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: AppColors.slate),
          ),
        ),
      );
    }
    final sender = members.whereType<Map>().cast<Map<dynamic, dynamic>>().where((row) => row['id'] == message['senderId']).firstOrNull ?? {};
    final seq = (message['sequenceNumber'] as num?)?.toInt() ?? 0;
    final read = members.whereType<Map>().any(
          (row) => row['id'] != currentUserId && ((row['lastReadSeq'] as num?)?.toInt() ?? 0) >= seq,
        );
    final type = message['messageType'] as String? ?? 'text';
    final content = (message['content'] as String?) ?? '';
    final showText = message['deletedAt'] != null || (content.isNotEmpty && type == 'text') || (content.isNotEmpty && type != 'text');
    final quoted = (message['replyTo'] as Map?)?.cast<String, dynamic>();
    final bubble = Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: (MediaQuery.sizeOf(context).width * 0.78).clamp(160.0, 520.0),
        ),
        child: Container(
          margin: EdgeInsets.fromLTRB(mine ? 52 : 12, 1, mine ? 12 : 52, 1),
          padding: const EdgeInsets.fromLTRB(10, 7, 10, 6),
          decoration: BoxDecoration(
            color: message['deletedAt'] != null
                ? AppColors.muted
                : mine
                    ? AppColors.outgoing
                    : AppColors.incoming,
            border: Border.all(
              color: selected
                  ? AppColors.gold
                  : mine
                      ? AppColors.gold.withValues(alpha: 0.28)
                      : AppColors.border,
            ),
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(16),
              topRight: const Radius.circular(16),
              bottomLeft: Radius.circular(mine ? 16 : 4),
              bottomRight: Radius.circular(mine ? 4 : 16),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!mine && isGroup)
                Text(
                  senderDisplayName(Map<String, dynamic>.from(sender)),
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.goldDeep),
                ),
              if (quoted != null || message['replyToMessageId'] != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6, top: 2),
                  child: ReplyPreview(
                    message: quoted ?? {'content': 'Original message', 'messageType': 'text'},
                    currentUserId: currentUserId,
                    compact: true,
                  ),
                ),
              if (message['deletedAt'] == null && messageAttachments(message).isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: AttachmentAlbum(files: messageAttachments(message)),
                ),
              if (showText)
                Text(
                  message['deletedAt'] != null ? 'This message was deleted' : previewText(message),
                  softWrap: true,
                  overflow: TextOverflow.ellipsis,
                  maxLines: 80,
                  style: TextStyle(
                    fontStyle: message['deletedAt'] != null ? FontStyle.italic : FontStyle.normal,
                    color: AppColors.navy,
                    fontSize: 15.5,
                    height: 1.35,
                  ),
                ),
              const SizedBox(height: 2),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    formatMessageTime(message['createdAt']),
                    style: const TextStyle(fontSize: 11, color: AppColors.mutedForeground),
                  ),
                  if (mine) ...[
                    const SizedBox(width: 4),
                    Icon(
                      message['pending'] == true
                          ? Icons.access_time
                          : message['failed'] == true
                              ? Icons.error_outline
                              : read
                                  ? Icons.done_all
                                  : Icons.done,
                      size: 14,
                      color: message['failed'] == true
                          ? AppColors.destructive
                          : read
                              ? AppColors.goldDeep
                              : AppColors.mutedForeground,
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );

    return ColoredBox(
      color: selected ? AppColors.selection : Colors.transparent,
      child: Column(
        children: [
          if (showDay)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.white.withValues(alpha: 0.92),
                    borderRadius: BorderRadius.circular(99),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Text(
                    formatDateSeparator(message['createdAt']),
                    style: const TextStyle(fontSize: 11, color: AppColors.slate, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
            ),
          GestureDetector(
            onTap: onTap,
            onLongPress: onLongPress,
            child: SwipeToReply(
              enabled: !selectionMode && message['deletedAt'] == null,
              onReply: onReply,
              child: Stack(
                children: [
                  bubble,
                  if (selected)
                    Positioned(
                      left: mine ? null : 8,
                      right: mine ? 8 : null,
                      top: 0,
                      bottom: 0,
                      child: const Center(
                        child: Icon(Icons.check_circle, color: AppColors.gold, size: 18),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class AttachmentAlbum extends StatelessWidget {
  const AttachmentAlbum({super.key, required this.files});

  final List<Map<String, dynamic>> files;

  @override
  Widget build(BuildContext context) {
    if (files.length == 1) return AttachmentThumb(attachment: files.first);
    final visuals = files.where((file) => file['kind'] == 'image' || file['kind'] == 'video').toList();
    final others = files.where((file) => file['kind'] != 'image' && file['kind'] != 'video').toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (visuals.isNotEmpty)
          SizedBox(
            width: 220,
            child: GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: visuals.length > 4 ? 4 : visuals.length,
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                mainAxisSpacing: 4,
                crossAxisSpacing: 4,
              ),
              itemBuilder: (context, index) {
                return ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: AttachmentThumb(attachment: visuals[index], compact: true),
                );
              },
            ),
          ),
        for (final file in others)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: AttachmentThumb(attachment: file),
          ),
      ],
    );
  }
}

class AttachmentThumb extends ConsumerStatefulWidget {
  const AttachmentThumb({super.key, required this.attachment, this.compact = false});

  final Map<String, dynamic> attachment;
  final bool compact;

  @override
  ConsumerState<AttachmentThumb> createState() => _AttachmentThumbState();
}

class _AttachmentThumbState extends ConsumerState<AttachmentThumb> {
  String? _url;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = widget.attachment['id'] as String?;
    if (id == null) return;
    try {
      final data = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/api/v1/attachments/$id/url');
      final url = data['url'] as String?;
      if (!mounted) return;
      setState(() => _url = url == null ? null : rewritePublicUrl(url));
    } catch (_) {}
  }

  String get _name {
    final display = widget.attachment['displayName'] as String?;
    final original = widget.attachment['originalName'] as String?;
    final value = (display != null && display.trim().isNotEmpty) ? display : original;
    return (value == null || value.trim().isEmpty) ? 'File' : value.trim();
  }

  @override
  Widget build(BuildContext context) {
    final kind = widget.attachment['kind'] as String? ?? '';
    if (kind == 'image') {
      return GestureDetector(
        onTap: _url == null
            ? null
            : () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => Scaffold(
                      backgroundColor: Colors.black,
                      appBar: AppBar(backgroundColor: Colors.black),
                      body: PhotoView(imageProvider: CachedNetworkImageProvider(_url!)),
                    ),
                  ),
                );
              },
        child: ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: SizedBox(
            height: widget.compact ? double.infinity : 180,
            width: widget.compact ? double.infinity : 220,
            child: _url == null
                ? const ColoredBox(color: AppColors.muted, child: Center(child: Icon(Icons.image_outlined)))
                : CachedNetworkImage(
                    imageUrl: _url!,
                    cacheKey: thumbCacheKey(widget.attachment['id'] as String?),
                    cacheManager: miChatMediaCache.thumbs,
                    fit: BoxFit.cover,
                    width: double.infinity,
                    height: double.infinity,
                  ),
          ),
        ),
      );
    }
    if (kind == 'video') {
      return GestureDetector(
        onTap: _url == null
            ? null
            : () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => _VideoViewer(url: _url!, title: _name)),
                );
              },
        child: ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: SizedBox(
            height: widget.compact ? double.infinity : 160,
            width: widget.compact ? double.infinity : 220,
            child: const ColoredBox(
              color: AppColors.muted,
              child: Center(
                child: CircleAvatar(backgroundColor: Colors.black54, child: Icon(Icons.play_arrow, color: Colors.white)),
              ),
            ),
          ),
        ),
      );
    }
    final size = (widget.attachment['sizeBytes'] as num?)?.toInt();
    return Material(
      color: AppColors.white,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: () async {
          final id = widget.attachment['id'] as String?;
          if (id == null) return;
          try {
            final file = await downloadAttachmentFile(
              api: ref.read(apiClientProvider),
              attachmentId: id,
              fileName: _name,
              sizeBytes: size,
            );
            await launchUrl(Uri.file(file.path), mode: LaunchMode.externalApplication);
          } catch (_) {
            if (_url != null) await launchUrl(Uri.parse(_url!), mode: LaunchMode.externalApplication);
          }
        },
        borderRadius: BorderRadius.circular(10),
        child: SizedBox(
          width: 220,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: Row(
              children: [
                Icon(kind == 'audio' ? Icons.audiotrack : Icons.insert_drive_file_outlined, size: 22, color: AppColors.goldDeep),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        softWrap: true,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                      ),
                      if (size != null)
                        Text(formatMediaSize(size), style: const TextStyle(fontSize: 11, color: AppColors.mutedForeground)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _VideoViewer extends StatefulWidget {
  const _VideoViewer({required this.url, required this.title});

  final String url;
  final String title;

  @override
  State<_VideoViewer> createState() => _VideoViewerState();
}

class _VideoViewerState extends State<_VideoViewer> {
  VideoPlayerController? _player;

  @override
  void initState() {
    super.initState();
    final player = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    _player = player;
    player.initialize().then((_) {
      if (!mounted) return;
      player.play();
      setState(() {});
    });
  }

  @override
  void dispose() {
    _player?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final player = _player;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, title: Text(widget.title, overflow: TextOverflow.ellipsis)),
      body: Center(
        child: player == null || !player.value.isInitialized
            ? const CircularProgressIndicator()
            : GestureDetector(
                onTap: () {
                  player.value.isPlaying ? player.pause() : player.play();
                  setState(() {});
                },
                child: AspectRatio(
                  aspectRatio: player.value.aspectRatio == 0 ? 16 / 9 : player.value.aspectRatio,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      VideoPlayer(player),
                      if (!player.value.isPlaying)
                        const CircleAvatar(backgroundColor: Colors.black54, child: Icon(Icons.play_arrow, color: Colors.white)),
                    ],
                  ),
                ),
              ),
      ),
    );
  }
}
