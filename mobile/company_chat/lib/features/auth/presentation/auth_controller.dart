import 'dart:async';

import 'package:company_chat/app/providers.dart';
import 'package:company_chat/core/network/api_client.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/notifications/notification_prefs.dart';
import 'package:company_chat/core/notifications/push_notifications.dart';
import 'package:company_chat/core/notifications/unread_inbox_store.dart';
import 'package:company_chat/core/storage/app_database.dart';
import 'package:company_chat/core/storage/media_cache.dart';
import 'package:company_chat/shared/models/user_profile.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class AuthState {
  const AuthState({this.user, this.status = AuthStatus.unknown});

  final UserProfile? user;
  final AuthStatus status;

  bool get isAuthenticated => user != null && status == AuthStatus.authenticated;
  bool get isAdmin => user?.isAdmin == true;
  bool get mustChangePassword => user?.mustChangePassword == true;
}

enum AuthStatus { unknown, anonymous, authenticated, unavailable }

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref) : super(const AuthState()) {
    _api.onSessionInvalid = _forceAnonymous;
    restore();
  }

  final Ref _ref;
  ApiClient get _api => _ref.read(apiClientProvider);

  Future<void> restore() async {
    state = const AuthState(status: AuthStatus.unknown);
    final store = _ref.read(sessionStoreProvider);
    final refresh = await store.readRefreshToken();
    if (refresh == null || refresh.isEmpty) {
      state = const AuthState(status: AuthStatus.anonymous);
      return;
    }
    try {
      final data = await _api.refresh();
      var profile = data['user'] as Map<String, dynamic>;
      try {
        profile = await _api.get<Map<String, dynamic>>('/api/v1/auth/me');
      } on ApiError catch (error) {
        if (error.isSessionInvalid) rethrow;
      }
      state = AuthState(
        user: UserProfile.fromJson(profile),
        status: AuthStatus.authenticated,
      );
      _ref.read(currentUserIdProvider.notifier).state = state.user?.id;
      await store.writeUserId(state.user?.id);
      _ref.read(chatSocketProvider).connect();
      try {
        await PushNotifications.register(_api);
        await _ref.read(notificationPrefsProvider.notifier).load();
      } catch (_) {}
    } on ApiError catch (error) {
      if (error.isSessionInvalid) {
        await _clearAccountCaches(state.user?.id ?? await store.readUserId());
        await store.clear();
        state = const AuthState(status: AuthStatus.anonymous);
        return;
      }
      state = const AuthState(status: AuthStatus.unavailable);
    } catch (_) {
      state = const AuthState(status: AuthStatus.unavailable);
    }
  }

  void _forceAnonymous() {
    final userId = state.user?.id;
    _ref.read(chatSocketProvider).disconnect();
    unawaited(() async {
      await _clearAccountCaches(userId ?? await _ref.read(sessionStoreProvider).readUserId());
    }());
    _ref.read(currentUserIdProvider.notifier).state = null;
    state = const AuthState(status: AuthStatus.anonymous);
  }

  Future<void> login({required String username, required String password}) async {
    try {
      final data = await _api.login(username: username, password: password);
      _apply(data);
    } on DioException catch (error) {
      throw toApiError(error);
    }
  }

  Future<Map<String, dynamic>> requestOtp(String phone) async {
    try {
      return await _api.requestOtp(phone);
    } on DioException catch (error) {
      throw toApiError(error);
    }
  }

  Future<void> verifyOtp({required String phone, required String code}) async {
    try {
      final data = await _api.verifyOtp(phone: phone, code: code);
      _apply(data);
    } on DioException catch (error) {
      throw toApiError(error);
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _api.post('/api/v1/auth/change-password', data: {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    });
    await logout();
  }

  Future<void> refreshProfile() async {
    final data = await _api.get<Map<String, dynamic>>('/api/v1/auth/me');
    state = AuthState(user: UserProfile.fromJson(data), status: AuthStatus.authenticated);
  }

  Future<void> logout() async {
    final userId = state.user?.id ?? await _ref.read(sessionStoreProvider).readUserId();
    try {
      await _api.post('/api/v1/auth/logout');
    } catch (_) {}
    _ref.read(chatSocketProvider).disconnect();
    await _clearAccountCaches(userId);
    await _ref.read(sessionStoreProvider).clear();
    _ref.read(currentUserIdProvider.notifier).state = null;
    state = const AuthState(status: AuthStatus.anonymous);
  }

  Future<void> _clearAccountCaches(String? userId) async {
    try {
      await _ref.read(conversationListStoreProvider).clear(userId);
    } catch (_) {}
    try {
      await unreadInboxStore.clear(userId);
    } catch (_) {}
    try {
      await AppDatabase.deleteStore(userId);
    } catch (_) {}
    try {
      await clearMediaCache();
    } catch (_) {}
  }

  void _apply(Map<String, dynamic> data) {
    final tokens = AuthTokens.fromJson(data);
    state = AuthState(user: tokens.user, status: AuthStatus.authenticated);
    _ref.read(currentUserIdProvider.notifier).state = state.user?.id;
    unawaited(_ref.read(sessionStoreProvider).writeUserId(state.user?.id));
    _ref.read(chatSocketProvider).connect();
    PushNotifications.register(_api);
    _ref.read(notificationPrefsProvider.notifier).load();
  }
}

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(ref);
});
