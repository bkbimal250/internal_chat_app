import 'package:company_chat/core/theme/app_colors.dart';
import 'package:company_chat/features/messages/presentation/widgets/reply_preview.dart';
import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import 'package:flutter/material.dart';

class MessageComposer extends StatelessWidget {
  const MessageComposer({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.onChanged,
    required this.onSend,
    required this.onAttach,
    required this.onCamera,
    required this.onMic,
    required this.emojiOpen,
    required this.onToggleEmoji,
    required this.hasText,
    this.recording = false,
    this.recordElapsed = Duration.zero,
    this.replyTo,
    this.editing = false,
    this.currentUserId,
    this.onCancelReply,
    this.enabled = true,
    this.uploading = false,
    this.attachmentsEnabled = false,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;
  final VoidCallback onSend;
  final VoidCallback onAttach;
  final VoidCallback onCamera;
  final VoidCallback onMic;
  final bool emojiOpen;
  final VoidCallback onToggleEmoji;
  final bool hasText;
  final bool recording;
  final Duration recordElapsed;
  final Map<String, dynamic>? replyTo;
  final bool editing;
  final String? currentUserId;
  final VoidCallback? onCancelReply;
  final bool enabled;
  final bool uploading;
  final bool attachmentsEnabled;

  String _elapsed(Duration value) {
    final minutes = value.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = value.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    final showSend = hasText || recording || !attachmentsEnabled;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (replyTo != null || editing)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: ReplyPreview(
              message: replyTo ?? const {'content': 'Editing message', 'senderName': 'You'},
              currentUserId: currentUserId,
              onClose: onCancelReply,
            ),
          ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Container(
                    decoration: BoxDecoration(
                      color: AppColors.composer,
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: recording
                        ? Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            child: Row(
                              children: [
                                const Icon(Icons.mic, color: AppColors.error),
                                const SizedBox(width: 8),
                                Text(
                                  'Recording ${_elapsed(recordElapsed)}',
                                  style: const TextStyle(fontWeight: FontWeight.w600),
                                ),
                              ],
                            ),
                          )
                        : Row(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              IconButton(
                                tooltip: 'Emoji',
                                onPressed: enabled ? onToggleEmoji : null,
                                icon: Icon(
                                  emojiOpen ? Icons.keyboard_outlined : Icons.emoji_emotions_outlined,
                                  color: AppColors.goldDeep,
                                ),
                              ),
                              Expanded(
                                child: TextField(
                                  controller: controller,
                                  focusNode: focusNode,
                                  enabled: enabled && !uploading,
                                  minLines: 1,
                                  maxLines: 5,
                                  textInputAction: TextInputAction.newline,
                                  onChanged: onChanged,
                                  onTap: () {
                                    if (emojiOpen) onToggleEmoji();
                                  },
                                  decoration: InputDecoration(
                                    hintText: editing ? 'Edit message' : 'Message',
                                    border: InputBorder.none,
                                    enabledBorder: InputBorder.none,
                                    focusedBorder: InputBorder.none,
                                    filled: false,
                                    isDense: true,
                                    contentPadding: const EdgeInsets.symmetric(vertical: 12),
                                  ),
                                ),
                              ),
                              if (attachmentsEnabled)
                                IconButton(
                                  tooltip: 'Attach',
                                  onPressed: enabled && !uploading ? onAttach : null,
                                  icon: const Icon(Icons.attach_file, color: AppColors.goldDeep),
                                ),
                              if (attachmentsEnabled && !hasText)
                                IconButton(
                                  tooltip: 'Camera',
                                  onPressed: enabled && !uploading ? onCamera : null,
                                  icon: const Icon(Icons.photo_camera_outlined, color: AppColors.goldDeep),
                                ),
                            ],
                          ),
                  ),
                ),
                const SizedBox(width: 6),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 160),
                  transitionBuilder: (child, animation) => ScaleTransition(scale: animation, child: child),
                  child: Material(
                    key: ValueKey(showSend ? 'send' : 'mic'),
                    color: AppColors.gold,
                    shape: const CircleBorder(),
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: !enabled || uploading
                          ? null
                          : recording
                              ? onMic
                              : showSend
                                  ? (hasText ? onSend : null)
                                  : onMic,
                      child: SizedBox(
                        width: 48,
                        height: 48,
                        child: Icon(
                          recording
                              ? Icons.stop
                              : showSend
                                  ? Icons.send
                                  : Icons.mic,
                          color: AppColors.navy,
                          size: 22,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (enabled && emojiOpen)
          SizedBox(
            height: 280,
            child: EmojiPicker(
              onEmojiSelected: (_, emoji) {
                final text = controller.text;
                final selection = controller.selection;
                final start = selection.isValid ? selection.start : text.length;
                final end = selection.isValid ? selection.end : text.length;
                final next = text.replaceRange(start, end, emoji.emoji);
                controller.value = TextEditingValue(
                  text: next,
                  selection: TextSelection.collapsed(offset: start + emoji.emoji.length),
                );
                onChanged(controller.text);
              },
            ),
          ),
      ],
    );
  }
}
