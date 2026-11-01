import 'dart:io';

class AppConfig {
  const AppConfig._();

  static const requestedWith = 'CompanyChatMobile';

  static String get apiBaseUrl {
    const defined = String.fromEnvironment('API_BASE_URL');
    if (defined.isNotEmpty) return _trim(defined);
    if (Platform.isAndroid) return 'http://10.0.2.2:3001';
    return 'http://127.0.0.1:3001';
  }

  static String get wsUrl {
    const defined = String.fromEnvironment('WS_URL');
    if (defined.isNotEmpty) return _trim(defined);
    return '${apiBaseUrl.replaceFirst(RegExp(r'^http'), 'ws')}/api/v1/ws';
  }

  static String _trim(String value) {
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }
}
