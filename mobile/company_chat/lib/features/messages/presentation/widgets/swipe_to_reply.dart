import 'package:company_chat/core/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class SwipeToReply extends StatefulWidget {
  const SwipeToReply({
    super.key,
    required this.child,
    required this.onReply,
    this.enabled = true,
  });

  final Widget child;
  final VoidCallback onReply;
  final bool enabled;

  @override
  State<SwipeToReply> createState() => _SwipeToReplyState();
}

class _SwipeToReplyState extends State<SwipeToReply> {
  double _dx = 0;
  bool _fired = false;

  static const _max = 72.0;
  static const _trigger = 42.0;

  void _reset() {
    setState(() {
      _dx = 0;
      _fired = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) return widget.child;
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onHorizontalDragUpdate: (details) {
        final next = (_dx + details.delta.dx).clamp(0.0, _max);
        setState(() => _dx = next);
        if (!_fired && next >= _trigger) {
          _fired = true;
          HapticFeedback.selectionClick();
        }
      },
      onHorizontalDragEnd: (_) {
        if (_dx >= _trigger) widget.onReply();
        _reset();
      },
      onHorizontalDragCancel: _reset,
      child: Stack(
        alignment: Alignment.centerLeft,
        children: [
          Opacity(
            opacity: (_dx / _trigger).clamp(0, 1),
            child: Padding(
              padding: const EdgeInsets.only(left: 10),
              child: CircleAvatar(
                radius: 14,
                backgroundColor: AppColors.goldSoft,
                child: Icon(Icons.reply, size: 16, color: AppColors.goldDeep.withValues(alpha: 0.9)),
              ),
            ),
          ),
          Transform.translate(
            offset: Offset(_dx, 0),
            child: widget.child,
          ),
        ],
      ),
    );
  }
}
