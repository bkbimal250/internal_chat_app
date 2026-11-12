import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionStore {
  SessionStore({FlutterSecureStorage? storage, Map<String, String>? memory})
      : _memory = memory,
        _storage = memory != null
            ? null
            : storage ??
                const FlutterSecureStorage(
                  aOptions: AndroidOptions(encryptedSharedPreferences: true),
                  iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
                );

  factory SessionStore.memory([Map<String, String>? seed]) =>
      SessionStore(memory: {...?seed});

  static const _refreshKey = 'company_chat.refresh_token';
  static const _deviceKey = 'company_chat.device_id';
  static const _userKey = 'company_chat.user_id';

  final FlutterSecureStorage? _storage;
  final Map<String, String>? _memory;
  String? accessToken;
  String? csrfToken;
  String? sessionId;
  String? deviceId;

  Future<String?> _read(String key) async {
    if (_memory != null) return _memory[key];
    return _storage!.read(key: key);
  }

  Future<void> _write(String key, String value) async {
    if (_memory != null) {
      _memory[key] = value;
      return;
    }
    await _storage!.write(key: key, value: value);
  }

  Future<void> _delete(String key) async {
    if (_memory != null) {
      _memory.remove(key);
      return;
    }
    await _storage!.delete(key: key);
  }

  Future<String?> readDeviceId() async {
    final existing = await _read(_deviceKey);
    if (existing != null && existing.isNotEmpty) {
      deviceId = existing;
      return existing;
    }
    return null;
  }

  Future<void> writeDeviceId(String? id) async {
    deviceId = id;
    if (id == null || id.isEmpty) {
      await _delete(_deviceKey);
      return;
    }
    await _write(_deviceKey, id);
  }

  Future<String?> readRefreshToken() => _read(_refreshKey);

  Future<void> writeRefreshToken(String? token) async {
    if (token == null || token.isEmpty) {
      await _delete(_refreshKey);
      return;
    }
    await _write(_refreshKey, token);
  }

  Future<String?> readUserId() => _read(_userKey);

  Future<void> writeUserId(String? id) async {
    if (id == null || id.isEmpty) {
      await _delete(_userKey);
      return;
    }
    await _write(_userKey, id);
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
    await _delete(_refreshKey);
    await _delete(_userKey);
    if (!keepDevice) await _delete(_deviceKey);
  }
}
