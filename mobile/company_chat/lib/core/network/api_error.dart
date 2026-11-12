class ApiError implements Exception {
  const ApiError({
    required this.message,
    this.status,
    this.code,
    this.requestId,
  });

  final String message;
  final int? status;
  final String? code;
  final String? requestId;

  bool get isAuthFailure => isSessionInvalid;

  bool get isSessionInvalid {
    if (status == 401) return true;
    const codes = {'INVALID_SESSION', 'CSRF_FAILED', 'TRANSPORT_FORBIDDEN'};
    return status == 403 && code != null && codes.contains(code);
  }

  bool get isNetworkError => status == null || status == 0 || (status != null && status! >= 500);

  @override
  String toString() => message;
}
