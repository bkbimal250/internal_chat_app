import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

const smsOtpChannelName = 'michat/sms_otp';

String? extractOtpCode(String? source) {
  if (source == null || source.isEmpty) return null;
  final match = RegExp(r'\b(\d{6})\b').firstMatch(source);
  return match?.group(1);
}

class SmsOtpAutofill {
  SmsOtpAutofill({
    MethodChannel? channel,
    this.onCode,
    bool? isAndroid,
  })  : _channel = channel ?? const MethodChannel(smsOtpChannelName),
        _isAndroid = isAndroid ?? (!kIsWeb && Platform.isAndroid);

  final MethodChannel _channel;
  final bool _isAndroid;
  final void Function(String code)? onCode;
  bool _listening = false;

  bool get isListening => _listening;

  Future<void> start({bool retriever = false}) async {
    if (!_isAndroid || _listening) return;
    _listening = true;
    try {
      final method = retriever ? 'startRetriever' : 'startUserConsent';
      final sms = await _channel.invokeMethod<String>(method);
      final code = extractOtpCode(sms);
      if (code != null) onCode?.call(code);
    } on PlatformException {
      // Manual entry remains available.
    } catch (_) {
    } finally {
      _listening = false;
    }
  }

  Future<void> stop() async {
    if (!_isAndroid) return;
    try {
      await _channel.invokeMethod<void>('stop');
    } catch (_) {}
    _listening = false;
  }
}
