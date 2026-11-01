import 'dart:io';

import 'package:company_chat/core/config/app_config.dart';
import 'package:company_chat/core/network/api_error.dart';
import 'package:company_chat/core/storage/session_store.dart';
import 'package:company_chat/core/utils/device_info.dart';
import 'package:dio/dio.dart';

class ApiClient {
  ApiClient(this.store)
      : dio = Dio(
          BaseOptions(
            baseUrl: AppConfig.apiBaseUrl,
            headers: {
              'Accept': 'application/json',
              'X-Requested-With': AppConfig.requestedWith,
            },
            connectTimeout: const Duration(seconds: 15),
            receiveTimeout: const Duration(seconds: 20),
          ),
        ) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          _attach(options);
          handler.next(options);
        },
        onError: (error, handler) async {
          final status = error.response?.statusCode;
          final path = error.requestOptions.path;
          if (status == 401 &&
              error.requestOptions.extra['retry'] != true &&
              !_isAuthUrl(path)) {
            try {
              await refresh();
              final retry = error.requestOptions;
              retry.extra['retry'] = true;
              _attach(retry);
              handler.resolve(await dio.fetch(retry));
              return;
            } catch (_) {
              await store.clear();
            }
          }
          handler.next(error);
        },
      ),
    );
  }

  final SessionStore store;
  final Dio dio;
  Future<Map<String, dynamic>>? _refreshing;

  void _attach(RequestOptions options) {
    options.headers['X-Requested-With'] = AppConfig.requestedWith;
    final token = store.accessToken;
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    final method = options.method.toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].contains(method) && store.csrfToken != null) {
      options.headers['X-CSRF-Token'] = store.csrfToken;
    }
  }

  bool _isAuthUrl(String path) {
    return path.contains('/api/v1/auth/login') ||
        path.contains('/api/v1/auth/otp/') ||
        path.contains('/api/v1/auth/refresh');
  }

  Future<Map<String, dynamic>> refresh() {
    _refreshing ??= () async {
      final refreshToken = await store.readRefreshToken();
      if (refreshToken == null || refreshToken.isEmpty) {
        throw const ApiError(message: 'Session expired', status: 401, code: 'UNAUTHORIZED');
      }
      final response = await dio.post<Map<String, dynamic>>(
        '/api/v1/auth/refresh',
        data: {
          'clientType': 'native',
          'refreshToken': refreshToken,
        },
      );
      final data = response.data ?? {};
      _applySession(data);
      await store.writeRefreshToken(data['refreshToken'] as String? ?? refreshToken);
      return data;
    }()
        .whenComplete(() => _refreshing = null);
    return _refreshing!;
  }

  void _applySession(Map<String, dynamic> data) {
    store.applyTokens(
      access: data['accessToken'] as String,
      csrf: data['csrfToken'] as String?,
      session: data['sessionId'] as String?,
      device: data['deviceId'] as String?,
    );
  }

  Future<Map<String, dynamic>> login({
    required String username,
    required String password,
  }) {
    return _nativeAuth(
      '/api/v1/auth/login',
      {
        'username': username,
        'password': password,
      },
    );
  }

  Future<Map<String, dynamic>> requestOtp(String phone) async {
    try {
      final response = await dio.post<Map<String, dynamic>>(
        '/api/v1/auth/otp/request',
        data: {'phone': phone},
      );
      return response.data ?? {};
    } on DioException catch (error) {
      throw toApiError(error);
    }
  }

  Future<Map<String, dynamic>> verifyOtp({
    required String phone,
    required String code,
  }) {
    return _nativeAuth(
      '/api/v1/auth/otp/verify',
      {
        'phone': phone,
        'code': code,
      },
    );
  }

  Future<Map<String, dynamic>> _nativeAuth(
    String path,
    Map<String, dynamic> body,
  ) async {
    try {
      return await _nativeAuthOnce(path, body, await store.readDeviceId());
    } on DioException catch (error) {
      if (_isInvalidDevice(error)) {
        await store.writeDeviceId(null);
        try {
          return await _nativeAuthOnce(path, body, null);
        } on DioException catch (retry) {
          throw toApiError(retry);
        }
      }
      throw toApiError(error);
    }
  }

  Future<Map<String, dynamic>> _nativeAuthOnce(
    String path,
    Map<String, dynamic> body,
    String? deviceId,
  ) async {
    final response = await dio.post<Map<String, dynamic>>(
      path,
      data: {
        ...body,
        'clientType': 'native',
        'platform': devicePlatform(),
        'deviceName': deviceName(),
        'deviceId': ?deviceId,
      },
    );
    return _capture(response.data ?? {});
  }

  bool _isInvalidDevice(DioException error) {
    final data = error.response?.data;
    if (error.response?.statusCode != 400 || data is! Map) return false;
    final payload = data['error'];
    return payload is Map && payload['code'] == 'INVALID_DEVICE';
  }

  Future<Map<String, dynamic>> _capture(Map<String, dynamic> data) async {
    _applySession(data);
    await store.writeRefreshToken(data['refreshToken'] as String?);
    await store.writeDeviceId(data['deviceId'] as String?);
    return data;
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) async {
    try {
      final response = await dio.get<T>(path, queryParameters: query);
      return response.data as T;
    } on DioException catch (error) {
      throw toApiError(error);
    }
  }

  Future<T> post<T>(String path, {Object? data}) async {
    try {
      final response = await dio.post<T>(path, data: data);
      return response.data as T;
    } on DioException catch (error) {
      throw toApiError(error);
    }
  }

  Future<T> put<T>(String path, {Object? data}) async {
    try {
      final response = await dio.put<T>(path, data: data);
      return response.data as T;
    } on DioException catch (error) {
      throw toApiError(error);
    }
  }

  Future<T> patch<T>(String path, {Object? data}) async {
    try {
      final response = await dio.patch<T>(path, data: data);
      return response.data as T;
    } on DioException catch (error) {
      throw toApiError(error);
    }
  }

  Future<T> delete<T>(String path, {Object? data}) async {
    try {
      final response = await dio.delete<T>(path, data: data);
      return response.data as T;
    } on DioException catch (error) {
      throw toApiError(error);
    }
  }

  Future<void> putBytes(
    String url,
    List<int> bytes, {
    Map<String, String>? headers,
    void Function(int sent, int total)? onProgress,
    CancelToken? cancelToken,
  }) async {
    await putFileRange(
      url,
      null,
      bytes: bytes,
      start: 0,
      end: bytes.length,
      headers: headers,
      onProgress: onProgress,
      cancelToken: cancelToken,
    );
  }

  Future<String?> putFileRange(
    String url,
    File? file, {
    List<int>? bytes,
    required int start,
    required int end,
    Map<String, String>? headers,
    void Function(int sent, int total)? onProgress,
    CancelToken? cancelToken,
  }) async {
    final length = end - start;
    final client = Dio(
      BaseOptions(
        connectTimeout: const Duration(seconds: 20),
        sendTimeout: const Duration(minutes: 10),
        receiveTimeout: const Duration(minutes: 10),
      ),
    );
    try {
      final response = await client.put<void>(
        url,
        data: bytes != null ? Stream<List<int>>.fromIterable([bytes.sublist(start, end)]) : file!.openRead(start, end),
        options: Options(
          headers: {
            ...?headers,
            'Content-Length': length,
          },
          responseType: ResponseType.plain,
        ),
        cancelToken: cancelToken,
        onSendProgress: onProgress,
      );
      return response.headers.value('etag') ?? response.headers.value('ETag');
    } on DioException catch (error) {
      if (CancelToken.isCancel(error)) rethrow;
      throw toApiError(error);
    }
  }
}

ApiError toApiError(DioException error) {
  final data = error.response?.data;
  if (data is Map && data['error'] is Map) {
    final payload = data['error'] as Map;
    return ApiError(
      message: payload['message']?.toString() ?? 'Request failed',
      status: error.response?.statusCode,
      code: payload['code']?.toString(),
      requestId: payload['requestId']?.toString(),
    );
  }
  return ApiError(
    message: error.message ?? 'Network error',
    status: error.response?.statusCode,
  );
}
