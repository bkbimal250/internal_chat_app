import 'dart:async';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/config/feature_flags.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/notifications/notification_prefs.dart';
import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/core/utils/preview_text.dart';
import 'package:company_chat/core/utils/typing_label.dart';
import 'package:company_chat/core/widgets/conversation_avatar.dart';
import 'package:company_chat/features/auth/presentation/auth_controller.dart';
import 'package:company_chat/features/calls/call_providers.dart';
import 'package:company_chat/features/conversations/presentation/conversations_controller.dart';
import 'package:company_chat/features/media/media_batch.dart';
import 'package:company_chat/features/media/media_limits.dart';
import 'package:company_chat/features/media/media_prepare.dart';
import 'package:company_chat/features/messages/message_actions.dart';
import 'package:company_chat/features/messages/message_share.dart';
import 'package:company_chat/features/messages/presentation/attach_sheet.dart';
import 'package:company_chat/features/messages/presentation/messages_controller.dart';
import 'package:company_chat/features/messages/presentation/widgets/delete_message_sheet.dart';
import 'package:company_chat/features/messages/presentation/widgets/forward_picker.dart';
import 'package:company_chat/features/messages/presentation/widgets/message_bubble.dart';
import 'package:company_chat/features/messages/presentation/widgets/selection_toolbar.dart';
import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _composer = TextEditingController();
  final _recorder = AudioRecorder();
  bool _emoji = false;
  bool _recording = false;
  Duration _recordElapsed = Duration.zero;
  List<SelectedMedia> _drafts = [];
  final Set<String> _selected = {};
  Timer? _typingStop;
  Timer? _recordTick;

  bool get _selecting => _selected.isNotEmpty;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(viewedConversationProvider.notifier).state = widget.conversationId;
    });
  }

  @override
  void dispose() {
    _typingStop?.cancel();
    _recordTick?.cancel();
    _recorder.dispose();
    _composer.dispose();
    ref.read(viewedConversationProvider.notifier).state = null;
    super.dispose();
  }

  void _onComposerChanged(MessagesController controller) {
    controller.typing(true);
    _typingStop?.cancel();
    _typingStop = Timer(const Duration(seconds: 2), () => controller.typing(false));
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(messagesControllerProvider(widget.conversationId));
    final controller = ref.read(messagesControllerProvider(widget.conversationId).notifier);
    ref.listen(messagesControllerProvider(widget.conversationId), (previous, next) {
      if (next.details?['removed'] == true && context.mounted) {
        context.go('/chats');
      }
    });
    final conversations = ref.watch(conversationsControllerProvider);
    final me = ref.watch(authControllerProvider).user?.id;
    final conversation = conversations.items.where((row) => row['id'] == widget.conversationId).firstOrNull ??
        state.details;
    final typingIds = ref.watch(typingProvider)[widget.conversationId] ?? {};
    final typing = remoteTypingLabel(
      userIds: typingIds,
      members: (conversation?['members'] as List?) ?? const [],
      currentUserId: me,
    );
    final title = conversation == null
        ? 'Chat'
        : ref.read(conversationsControllerProvider.notifier).titleOf(conversation);
    final isGroup = conversation?['type'] == 'group';
    final settings = (conversation?['settings'] as Map?)?.cast<String, dynamic>() ?? {};
    final myRole = ((conversation?['members'] as List?) ?? [])
        .whereType<Map>()
        .cast<Map<String, dynamic>>()
        .where((member) => member['id'] == me)
        .map((member) => member['role'] as String?)
        .firstOrNull;
    final canSend = !isGroup || settings['sendMessages'] != 'admins' || myRole == 'owner' || myRole == 'admin';
    final attachmentsEnabled = ref.watch(featureFlagsProvider.select((s) => s.chatAttachmentsEnabled));
    final callingEnabled = ref.watch(callControllerProvider.select((s) => s.capabilities.enabled));
    final peer = conversation == null ? null : ref.read(conversationsControllerProvider.notifier).peer(conversation);
    final online = ref.watch(onlineUsersProvider);

    final selectedMessages = state.messages.where((row) => _selected.contains(row['id'])).toList();
    return PopScope(
      canPop: !_selecting,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _selecting) {
          setState(_selected.clear);
          return;
        }
        if (didPop) ref.read(viewedConversationProvider.notifier).state = null;
      },
      child: Scaffold(
        appBar: _selecting
            ? AppBar(
                leading: IconButton(
                  tooltip: 'Cancel',
                  onPressed: () => setState(_selected.clear),
                  icon: const Icon(Icons.close),
                ),
                title: Text('${_selected.length} selected'),
                actions: [
                  MessageSelectionActions(
                    compact: MediaQuery.sizeOf(context).width < 400,
                    showReply: selectionCanReply(selectedMessages),
                    showForward: selectionCanForward(selectedMessages),
                    showCopy: selectionCanCopy(selectedMessages),
                    showDelete: selectionCanDelete(selectedMessages),
                    showShare: selectionCanShare(selectedMessages),
                    onReply: () {
                      controller.setReply(selectedMessages.first);
                      setState(_selected.clear);
                    },
                    onForward: () => _forwardSelected(controller, selectedMessages),
                    onCopy: () async {
                      await Clipboard.setData(ClipboardData(text: copySelectedText(selectedMessages)));
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
                      }
                    },
                    onDelete: () => _deleteSelected(controller, selectedMessages, conversation?['type'] as String?),
                    onShare: () async {
                      try {
                        await const MessageShare().share(selectedMessages);
                      } catch (error) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
                        }
                      }
                    },
                  ),
                ],
              )
            : AppBar(
          title: Row(
            children: [
              ConversationAvatar.from(
                conversation: conversation,
                peer: peer,
                title: title,
                online: !isGroup && online.contains(peer?['id']),
                size: 36,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, overflow: TextOverflow.ellipsis),
                    Text(
                      typing.isNotEmpty
                          ? typing
                          : !isGroup && online.contains(peer?['id'])
                              ? 'online'
                              : isGroup
                                  ? '${((conversation?['members'] as List?) ?? []).length} members'
                                  : '',
                      style: const TextStyle(fontSize: 12, color: AppColors.gold),
                    ),
                  ],
                ),
              ),
            ],
          ),
          actions: [
            if (!isGroup && callingEnabled && peer != null)
              IconButton(
                tooltip: 'Voice call',
                onPressed: () async {
                  try {
                    await ref.read(callControllerProvider.notifier).startCall(
                          userId: peer['id'] as String,
                          name: title,
                          hasPhoto: peer['hasProfilePhoto'] == true,
                          photoVersion: peer['photoVersion']?.toString(),
                        );
                  } catch (error) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
                    }
                  }
                },
                icon: const Icon(Icons.call_outlined),
              ),
            if (isGroup)
              IconButton(
                onPressed: () => context.push('/groups/${widget.conversationId}/info'),
                icon: const Icon(Icons.info_outline),
              ),
            IconButton(
              tooltip: ref.watch(notificationPrefsProvider).isMuted(widget.conversationId)
                  ? 'Unmute notifications'
                  : 'Mute notifications',
              onPressed: () {
                final muted = ref.read(notificationPrefsProvider).isMuted(widget.conversationId);
                ref.read(notificationPrefsProvider.notifier).setMuted(widget.conversationId, !muted);
              },
              icon: Icon(
                ref.watch(notificationPrefsProvider).isMuted(widget.conversationId)
                    ? Icons.notifications_off_outlined
                    : Icons.notifications_none_outlined,
              ),
            ),
          ],
        ),
        body: Column(
          children: [
            if (state.uploading)
              Material(
                color: AppColors.muted,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      LinearProgressIndicator(value: state.uploadProgress == 0 ? null : state.uploadProgress / 100),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              [
                                state.uploadLabel,
                                if (state.uploadOriginalSize > 0 &&
                                    state.uploadCompressedSize > 0 &&
                                    state.uploadCompressedSize != state.uploadOriginalSize)
                                  'was ${formatMediaSize(state.uploadOriginalSize)}',
                                if (state.uploadEta != null) formatEta(state.uploadEta),
                              ].where((part) => part.toString().isNotEmpty).join(' · '),
                              style: const TextStyle(fontSize: 11, color: AppColors.mutedForeground),
                            ),
                          ),
                          TextButton(
                            onPressed: controller.cancelUpload,
                            child: const Text('Cancel'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            if (state.retention != null)
              Material(
                color: const Color(0xFFFFF7E6),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                  child: Text(
                    'Messages older than ${state.retention!['retentionDays'] ?? 90} days are automatically deleted according to your company\'s retention policy.',
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              ),
            Expanded(
              child: DecoratedBox(
                decoration: const BoxDecoration(color: AppColors.wallpaper),
                child: state.messages.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(
                            (state.details?['lastMessageSeq'] as num? ?? 0) > 0
                                ? 'Messages older than ${state.retention?['retentionDays'] ?? 90} days are automatically deleted according to your company\'s retention policy.'
                                : 'No messages yet. Say hello to start this conversation.',
                            textAlign: TextAlign.center,
                          ),
                        ),
                      )
                    : ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  itemCount: state.messages.length,
                  itemBuilder: (context, index) {
                    final i = state.messages.length - 1 - index;
                    final message = state.messages[i];
                    final previous = i == 0 ? null : state.messages[i - 1];
                    final id = message['id'] as String?;
                    return MessageBubble(
                      key: ValueKey((id ?? message['clientMessageId'] ?? i).toString()),
                      message: message,
                      previous: previous,
                      currentUserId: me,
                      isGroup: isGroup,
                      members: (state.details?['members'] as List?) ?? [],
                      selected: id != null && _selected.contains(id),
                      selectionMode: _selecting,
                      onReply: () => controller.setReply(message),
                      onLongPress: () {
                        if (id == null || !isSelectableMessage(message)) return;
                        setState(() => _selected.add(id));
                      },
                      onTap: !_selecting
                          ? null
                          : () {
                              if (id == null || !isSelectableMessage(message)) return;
                              setState(() {
                                if (_selected.contains(id)) {
                                  _selected.remove(id);
                                } else {
                                  _selected.add(id);
                                }
                              });
                            },
                    );
                  },
                ),
              ),
            ),
            if (_drafts.isNotEmpty)
              SizedBox(
                height: 88,
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                  scrollDirection: Axis.horizontal,
                  itemCount: _drafts.length,
                  separatorBuilder: (context, index) => const SizedBox(width: 8),
                  itemBuilder: (context, index) {
                    final item = _drafts[index];
                    return Stack(
                      children: [
                        Container(
                          width: 72,
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(
                            color: AppColors.muted,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(
                                item.media.kind == 'image'
                                    ? Icons.image_outlined
                                    : item.media.kind == 'video'
                                        ? Icons.videocam_outlined
                                        : item.media.kind == 'audio'
                                            ? Icons.audiotrack
                                            : Icons.insert_drive_file_outlined,
                                size: 18,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                item.media.fileName,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                softWrap: true,
                                style: const TextStyle(fontSize: 10),
                              ),
                              Text(formatMediaSize(item.media.sizeBytes), style: const TextStyle(fontSize: 9, color: AppColors.mutedForeground)),
                            ],
                          ),
                        ),
                        Positioned(
                          top: -8,
                          right: -8,
                          child: IconButton(
                            iconSize: 16,
                            onPressed: () => setState(() => _drafts = [..._drafts]..removeAt(index)),
                            icon: const Icon(Icons.close),
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
            if (state.replyTo != null || state.editing != null)
              Container(
                color: AppColors.muted,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        state.editing != null
                            ? 'Editing message'
                            : 'Replying to ${previewText(state.replyTo)}',
                      ),
                    ),
                    IconButton(
                      onPressed: () {
                        controller.setReply(null);
                        controller.setEditing(null);
                      },
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
            if (_selecting)
              const SizedBox.shrink()
            else if (!canSend)
              const SafeArea(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(
                    'Only group admins can send messages.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.mutedForeground),
                  ),
                ),
              )
            else
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
                child: Row(
                  children: [
                    if (attachmentsEnabled)
                      IconButton(
                        onPressed: state.uploading || _recording ? null : () => _attach(controller),
                        icon: const Icon(Icons.attach_file, color: AppColors.gold),
                      ),
                    if (attachmentsEnabled)
                      IconButton(
                        onPressed: state.uploading ? null : () => _toggleVoice(controller),
                        icon: Icon(_recording ? Icons.stop_circle_outlined : Icons.mic_none, color: AppColors.gold),
                      ),
                    Expanded(
                      child: _recording
                          ? Container(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                              decoration: BoxDecoration(
                                color: AppColors.card,
                                borderRadius: BorderRadius.circular(24),
                                border: Border.all(color: AppColors.border),
                              ),
                              child: Text(
                                'Recording ${_formatElapsed(_recordElapsed)}',
                                style: const TextStyle(fontWeight: FontWeight.w600),
                              ),
                            )
                          : TextField(
                              controller: _composer,
                              minLines: 1,
                              maxLines: 5,
                              textInputAction: TextInputAction.send,
                              onChanged: (_) => _onComposerChanged(controller),
                              onSubmitted: (_) => _send(controller),
                              decoration: InputDecoration(
                                hintText: state.editing != null ? 'Edit message' : 'Type a message',
                                prefixIcon: IconButton(
                                  onPressed: () => setState(() => _emoji = !_emoji),
                                  icon: const Icon(Icons.emoji_emotions_outlined, color: AppColors.gold),
                                ),
                              ),
                            ),
                    ),
                    IconButton(
                      onPressed: _recording ? () => _toggleVoice(controller) : () => _send(controller),
                      icon: const Icon(Icons.send, color: AppColors.goldDeep),
                    ),
                  ],
                ),
              ),
            ),
            if (canSend && !_selecting && _emoji)
              SizedBox(
                height: 280,
                child: EmojiPicker(
                  onEmojiSelected: (_, emoji) {
                    _composer.text += emoji.emoji;
                    _composer.selection = TextSelection.collapsed(offset: _composer.text.length);
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _send(MessagesController controller) async {
    _typingStop?.cancel();
    controller.typing(false);
    if (_drafts.isNotEmpty) {
      final media = _drafts.map((item) => item.media).toList();
      final caption = _composer.text.trim();
      try {
        await controller.sendAttachments(media, caption: caption.isEmpty ? null : caption);
        _composer.clear();
        if (mounted) setState(() => _drafts = []);
      } catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
        }
      }
      return;
    }
    final text = _composer.text;
    _composer.clear();
    await controller.send(text);
  }

  void _queueMedia(Iterable<PreparedMedia> incoming) {
    final result = addSelectedMedia(_drafts, incoming);
    setState(() => _drafts = result.items);
    if (result.errors.isNotEmpty && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(result.errors.first)));
    }
  }

  String _formatElapsed(Duration value) {
    final minutes = value.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = value.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  Future<void> _toggleVoice(MessagesController controller) async {
    if (!ref.read(featureFlagsProvider).chatAttachmentsEnabled) return;
    try {
      if (_recording) {
        final path = await _recorder.stop();
        _recordTick?.cancel();
        setState(() {
          _recording = false;
          _recordElapsed = Duration.zero;
        });
        if (path == null || path.isEmpty) return;
        final media = await prepareFile(fileName: 'voice.m4a', mimeType: 'audio/mp4', path: path);
        await controller.sendAttachment(media, caption: _composer.text.trim());
        _composer.clear();
        return;
      }
      if (!await _recorder.hasPermission()) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Microphone access is required to send audio')),
          );
        }
        return;
      }
      final dir = await getTemporaryDirectory();
      final path = p.join(dir.path, 'voice-${DateTime.now().millisecondsSinceEpoch}.m4a');
      await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc), path: path);
      setState(() {
        _recording = true;
        _recordElapsed = Duration.zero;
      });
      _recordTick = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted) return;
        setState(() => _recordElapsed += const Duration(seconds: 1));
      });
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _sendPrepared(MessagesController controller, PreparedMedia media) async {
    _queueMedia([media]);
  }

  Future<void> _attach(MessagesController controller) async {
    if (!ref.read(featureFlagsProvider).chatAttachmentsEnabled) return;
    final choice = await showAttachSheet(context);
    if (choice == null) return;
    final quality = choice.quality;
    try {
      if (choice.kind == 'document') {
        final picked = await FilePicker.platform.pickFiles(
          withData: false,
          allowMultiple: true,
          type: FileType.custom,
          allowedExtensions: const ['pdf', 'docx', 'xlsx', 'pptx', 'zip', 'txt'],
        );
        final files = picked?.files.where((file) => file.path != null).toList() ?? [];
        if (files.isEmpty) return;
        final prepared = <PreparedMedia>[];
        for (final file in files) {
          prepared.add(await prepareFile(fileName: file.name, mimeType: mimeFromName(file.name), path: file.path));
        }
        _queueMedia(prepared);
        return;
      }
      if (choice.kind == 'audio') {
        final picked = await FilePicker.platform.pickFiles(withData: false, allowMultiple: true, type: FileType.audio);
        final files = picked?.files.where((file) => file.path != null).toList() ?? [];
        if (files.isEmpty) return;
        final prepared = <PreparedMedia>[];
        for (final file in files) {
          prepared.add(
            await prepareFile(
              fileName: file.name,
              mimeType: mimeFromName(file.name, file.extension == 'm4a' ? 'audio/mp4' : null),
              path: file.path,
            ),
          );
        }
        _queueMedia(prepared);
        return;
      }
      if (choice.kind == 'camera') {
        if (!mounted) return;
        final mode = await showCameraCaptureSheet(context);
        if (mode == 'photo') {
          final picked = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 92);
          if (picked == null) return;
          await _sendPrepared(
            controller,
            await prepareImage(path: picked.path, fileName: picked.name, mimeType: picked.mimeType, quality: quality),
          );
        } else if (mode == 'video') {
          final picked = await ImagePicker().pickVideo(source: ImageSource.camera);
          if (picked == null) return;
          await _sendPrepared(
            controller,
            await prepareVideo(path: picked.path, fileName: picked.name, quality: quality),
          );
        }
        return;
      }
      if (choice.kind == 'media') {
        final picked = await ImagePicker().pickMultipleMedia();
        if (picked.isEmpty) return;
        final prepared = <PreparedMedia>[];
        for (final file in picked) {
          final mime = file.mimeType ?? mimeFromName(file.name);
          final isVideo = mime.startsWith('video') || ['.mp4', '.mov', '.webm', '.3gp'].contains(p.extension(file.name).toLowerCase());
          prepared.add(
            isVideo
                ? await prepareVideo(path: file.path, fileName: file.name, quality: quality)
                : await prepareImage(path: file.path, fileName: file.name, mimeType: mime, quality: quality),
          );
        }
        _queueMedia(prepared);
      }
    } on MediaLimitException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
      }
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _forwardSelected(MessagesController controller, List<Map<String, dynamic>> messages) async {
    final list = ref.read(conversationsControllerProvider);
    final notifier = ref.read(conversationsControllerProvider.notifier);
    final target = await showForwardPicker(
      context,
      conversations: list.items,
      currentConversationId: widget.conversationId,
      titleOf: notifier.titleOf,
      peerOf: notifier.peer,
    );
    if (target == null) return;
    if (messages.length == 1) {
      await controller.forward(messages.first, target);
    } else {
      await controller.forwardMany(messages, target);
    }
    if (mounted) setState(_selected.clear);
  }

  Future<void> _deleteSelected(
    MessagesController controller,
    List<Map<String, dynamic>> messages,
    String? conversationType,
  ) async {
    final me = ref.read(authControllerProvider).user?.id;
    final allowEveryone = selectionCanDeleteForEveryone(
      messages,
      currentUserId: me,
      conversationType: conversationType,
    );
    final choice = await showDeleteMessageSheet(
      context,
      count: messages.length,
      allowEveryone: allowEveryone,
    );
    if (choice == null) return;
    final ids = messages.map((row) => row['id'] as String).where((id) => id.isNotEmpty);
    if (choice == DeleteMessageChoice.everyone) {
      await controller.removeMany(ids);
    } else {
      await controller.hideMany(ids);
    }
    if (mounted) setState(_selected.clear);
  }
}
