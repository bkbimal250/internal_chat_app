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

  bool get isAuthFailure => status == 401 || status == 403;

  @override
  String toString() => message;
}
