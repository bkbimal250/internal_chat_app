import 'dart:io';

import 'package:flutter/foundation.dart';

class AppConfig {
  const AppConfig._();

  static const requestedWith = 'CompanyChatMobile';
  static const productionApiBaseUrl = 'https://api.michat.in';
  static const productionWsUrl = 'wss://api.michat.in/api/v1/ws';

  static String get apiBaseUrl => resolveApiBaseUrl(
        defined: const String.fromEnvironment('API_BASE_URL'),
        release: kReleaseMode,
        android: !kIsWeb && Platform.isAndroid,
      );

  static String get wsUrl => resolveWsUrl(
        defined: const String.fromEnvironment('WS_URL'),
        apiBaseUrl: apiBaseUrl,
        release: kReleaseMode,
      );
}

String resolveApiBaseUrl({
  required String defined,
  required bool release,
  required bool android,
}) {
  final source = defined.trim();
  if (source.isNotEmpty) {
    return _assertProductionHttp(_trim(source), release: release);
  }
  if (release) return AppConfig.productionApiBaseUrl;
  if (android) return 'http://10.0.2.2:3001';
  return 'http://127.0.0.1:3001';
}

String resolveWsUrl({
  required String defined,
  required String apiBaseUrl,
  required bool release,
}) {
  final source = defined.trim();
  final url = source.isNotEmpty
      ? _trim(source)
      : '${apiBaseUrl.replaceFirst(RegExp(r'^http'), 'ws')}/api/v1/ws';
  return _assertProductionWs(url, release: release);
}

bool isDisallowedProductionHost(String host) {
  final normalized = host.toLowerCase().replaceAll(RegExp(r'^\[|\]$'), '');
  if (normalized == 'localhost' ||
      normalized == '127.0.0.1' ||
      normalized == '10.0.2.2' ||
      normalized == '::1' ||
      normalized == '0.0.0.0') {
    return true;
  }
  return RegExp(r'^\d{1,3}(\.\d{1,3}){3}$').hasMatch(normalized);
}

String _trim(String value) => value.endsWith('/') ? value.substring(0, value.length - 1) : value;

String _assertProductionHttp(String url, {required bool release}) {
  if (!release) return url;
  final uri = Uri.tryParse(url);
  if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
    throw StateError('Release API_BASE_URL must be an HTTPS origin such as ${AppConfig.productionApiBaseUrl}');
  }
  if (isDisallowedProductionHost(uri.host)) {
    throw StateError('Release API_BASE_URL cannot use localhost, emulator, or raw IP addresses');
  }
  return url;
}

String _assertProductionWs(String url, {required bool release}) {
  if (!release) return url;
  final uri = Uri.tryParse(url);
  if (uri == null || uri.scheme != 'wss' || uri.host.isEmpty || uri.path != '/api/v1/ws') {
    throw StateError('Release WS_URL must be ${AppConfig.productionWsUrl}');
  }
  if (isDisallowedProductionHost(uri.host)) {
    throw StateError('Release WS_URL cannot use localhost, emulator, or raw IP addresses');
  }
  return url;
}
