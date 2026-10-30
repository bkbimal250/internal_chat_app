export function loadEnv(source = process.env) {
  const errors = [];
  const integer = (key, fallback, min, max) => {
    const value = source[key] ?? String(fallback);
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
      errors.push(`${key} must be an integer between ${min} and ${max}`);
    }
    return number;
  };
  const nodeEnv = source.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) errors.push('NODE_ENV is invalid');
  const logLevel = source.LOG_LEVEL ?? 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) {
    errors.push('LOG_LEVEL is invalid');
  }
  let databaseUrl = source.DATABASE_URL;
  // Build a safely encoded URL for Docker without leaking credentials to validation errors.
  if (!databaseUrl && source.POSTGRES_USER && source.POSTGRES_PASSWORD && source.POSTGRES_DB) {
    databaseUrl = `postgresql://${encodeURIComponent(source.POSTGRES_USER)}:${encodeURIComponent(source.POSTGRES_PASSWORD)}@postgres:5432/${encodeURIComponent(source.POSTGRES_DB)}`;
  }
  try {
    const url = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.pathname.length < 2
    )
      throw new Error();
  } catch {
    errors.push('DATABASE_URL must be a PostgreSQL URL with user, password, host and database');
  }
  const corsOrigins = (source.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error();
    } catch {
      errors.push('CORS_ORIGINS must contain exact HTTP(S) origins');
    }
  }
  const config = {
    nodeEnv,
    logLevel,
    databaseUrl,
    corsOrigins,
    jwtSecret: source.JWT_SECRET,
    jwtIssuer: source.JWT_ISSUER ?? 'company-chat-api',
    jwtAudience: source.JWT_AUDIENCE ?? 'company-chat-clients',
    refreshTokenDays: integer('REFRESH_TOKEN_DAYS', 30, 1, 90),
    authRateLimit: integer('AUTH_RATE_LIMIT', 10, 1, 1000),
    groupMemberLimit: integer('GROUP_MEMBER_LIMIT', 1000, 2, 10000),
    wsHeartbeatIntervalMs: integer(
      'WS_HEARTBEAT_INTERVAL_MS',
      30000,
      nodeEnv === 'test' ? 25 : 10000,
      60000,
    ),
    cleanupIntervalMs: integer('SESSION_CLEANUP_INTERVAL_MS', 3600000, 60000, 86400000),
    s3Endpoint: source.S3_ENDPOINT ?? '',
    s3PublicEndpoint: source.S3_PUBLIC_ENDPOINT ?? source.S3_ENDPOINT ?? '',
    s3Region: source.S3_REGION ?? 'us-east-1',
    s3Bucket: source.S3_BUCKET ?? 'company-chat',
    s3AccessKey: source.S3_ACCESS_KEY ?? '',
    s3SecretKey: source.S3_SECRET_KEY ?? '',
    s3ForcePathStyle: source.S3_FORCE_PATH_STYLE !== 'false',
    s3UploadTtlSeconds: integer('S3_UPLOAD_TTL_SECONDS', 300, 30, 3600),
    s3DownloadTtlSeconds: integer('S3_DOWNLOAD_TTL_SECONDS', 60, 15, 600),
    attachmentPendingTtlMs: integer('ATTACHMENT_PENDING_TTL_MS', 900000, 60000, 86400000),
    attachmentDailyQuotaBytes: integer(
      'ATTACHMENT_DAILY_QUOTA_BYTES',
      209715200,
      1024 * 1024,
      10 * 1024 * 1024 * 1024,
    ),
    attachmentRateLimit: integer('ATTACHMENT_RATE_LIMIT', 20, 1, 1000),
    host: source.HOST ?? '0.0.0.0',
    port: integer('PORT', 3001, 1, 65535),
    dbPoolMax: integer('DB_POOL_MAX', 10, 1, 100),
    dbConnectTimeoutMs: integer('DB_CONNECT_TIMEOUT_MS', 5000, 100, 60000),
    dbQueryTimeoutMs: integer('DB_QUERY_TIMEOUT_MS', 5000, 100, 60000),
    shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 10000, 1000, 60000),
  };
  if (!config.jwtSecret || config.jwtSecret.length < 64)
    errors.push('JWT_SECRET must contain at least 64 random characters');
  if (!config.jwtIssuer.trim() || !config.jwtAudience.trim())
    errors.push('JWT issuer and audience must not be empty');
  if (nodeEnv === 'production' && corsOrigins.some((origin) => !origin.startsWith('https://'))) {
    errors.push('Production CORS_ORIGINS must use HTTPS');
  }
  if (nodeEnv === 'production') {
    if (!config.s3Endpoint.trim() || !config.s3AccessKey.trim() || !config.s3SecretKey.trim()) {
      errors.push('Production S3 endpoint and credentials are required');
    }
    try {
      const url = new URL(config.s3Endpoint);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      errors.push('S3_ENDPOINT must be an HTTP(S) URL');
    }
  }
  if (!config.host.trim()) errors.push('HOST must not be empty');
  if (errors.length) throw new Error(`Invalid environment: ${errors.join('; ')}`);
  return Object.freeze(config);
}
