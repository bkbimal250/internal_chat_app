import 'dart:ui';

import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/features/messages/message_actions.dart';
import 'package:share_plus/share_plus.dart';

class MessageShare {
  const MessageShare({this.shareTextFn});

  final Future<void> Function(String text)? shareTextFn;

  Future<void> share(List<Map<String, dynamic>> selected, {Rect? sharePositionOrigin}) async {
    final text = copySelectedText(selected);
    if (text.isEmpty) {
      throw const ApiError(
        message: 'File sharing is not available until company storage is configured.',
        code: 'SHARE_UNAVAILABLE',
      );
    }
    if (shareTextFn != null) {
      await shareTextFn!(text);
      return;
    }
    await SharePlus.instance.share(
      ShareParams(
        text: text,
        subject: 'MiChat',
        sharePositionOrigin: sharePositionOrigin,
      ),
    );
  }
}
