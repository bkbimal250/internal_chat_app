import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionStore {
  SessionStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  static const _refreshKey = 'company_chat.refresh_token';
  static const _deviceKey = 'company_chat.device_id';

  final FlutterSecureStorage _storage;
  String? accessToken;
  String? csrfToken;
  String? sessionId;
  String? deviceId;

  Future<String?> readDeviceId() async {
    final existing = await _storage.read(key: _deviceKey);
    if (existing != null && existing.isNotEmpty) {
      deviceId = existing;
      return existing;
    }
    return null;
  }

  Future<void> writeDeviceId(String? id) async {
    deviceId = id;
    if (id == null || id.isEmpty) {
      await _storage.delete(key: _deviceKey);
      return;
    }
    await _storage.write(key: _deviceKey, value: id);
  }

  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  Future<void> writeRefreshToken(String? token) async {
    if (token == null || token.isEmpty) {
      await _storage.delete(key: _refreshKey);
      return;
    }
    await _storage.write(key: _refreshKey, value: token);
  }

  void applyTokens({
    required String access,
    String? csrf,
    String? session,
    String? device,
  }) {
    accessToken = access;
    csrfToken = csrf;
    sessionId = session ?? sessionId;
    deviceId = device ?? deviceId;
  }

  Future<void> clear({bool keepDevice = true}) async {
    accessToken = null;
    csrfToken = null;
    sessionId = null;
    await _storage.delete(key: _refreshKey);
    if (!keepDevice) await _storage.delete(key: _deviceKey);
  }
}
