import 'package:company_chat/core/config/app_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('release builds default to the production HTTPS API', () {
    expect(
      resolveApiBaseUrl(defined: '', release: true, android: true),
      'https://api.michat.in',
    );
    expect(
      resolveWsUrl(defined: '', apiBaseUrl: 'https://api.michat.in', release: true),
      'wss://api.michat.in/api/v1/ws',
    );
  });

  test('debug builds keep emulator loopback unless dart-define is set', () {
    expect(
      resolveApiBaseUrl(defined: '', release: false, android: true),
      'http://10.0.2.2:3001',
    );
    expect(
      resolveApiBaseUrl(defined: '', release: false, android: false),
      'http://127.0.0.1:3001',
    );
    expect(
      resolveApiBaseUrl(
        defined: 'https://api.michat.in',
        release: false,
        android: true,
      ),
      'https://api.michat.in',
    );
  });

  test('release dart-defines reject localhost, emulator IPs, and HTTP', () {
    expect(
      () => resolveApiBaseUrl(defined: 'http://10.0.2.2:3001', release: true, android: true),
      throwsStateError,
    );
    expect(
      () => resolveApiBaseUrl(defined: 'https://127.0.0.1', release: true, android: false),
      throwsStateError,
    );
    expect(
      () => resolveApiBaseUrl(defined: 'https://203.0.113.10', release: true, android: false),
      throwsStateError,
    );
    expect(
      () => resolveWsUrl(
        defined: 'ws://api.michat.in/api/v1/ws',
        apiBaseUrl: 'https://api.michat.in',
        release: true,
      ),
      throwsStateError,
    );
  });

  test('identifies hosts that must not ship in production', () {
    expect(isDisallowedProductionHost('localhost'), isTrue);
    expect(isDisallowedProductionHost('10.0.2.2'), isTrue);
    expect(isDisallowedProductionHost('127.0.0.1'), isTrue);
    expect(isDisallowedProductionHost('api.michat.in'), isFalse);
  });
}
