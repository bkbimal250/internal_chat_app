export function loadEnv(source = process.env) {
  const errors = [];
  const flagEnabled = (value, fallback) => {
    if (value == null || value === '') return fallback;
    return ['1', 'true', 'TRUE', 'yes', 'YES'].includes(value);
  };
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
    otpRateLimit: integer('OTP_RATE_LIMIT', 8, 1, 1000),
    otpTtlSeconds: integer('OTP_TTL_SECONDS', 60, 30, 900),
    otpResendSeconds: integer('OTP_RESEND_SECONDS', 60, 10, 300),
    otpMaxAttempts: integer('OTP_MAX_ATTEMPTS', 5, 1, 10),
    otpMaxPerHour: integer('OTP_MAX_PER_HOUR', 5, 1, 50),
    smsApiUrl: source.SMS_API_URL ?? 'https://www.hilitemultimedia.co.in/websms/api/http/index.php',
    smsUsername: source.SMS_USERNAME ?? '',
    smsApiKey: source.SMS_API_KEY ?? '',
    smsTemplateId: source.SMS_TEMPLATE_ID ?? '',
    smsSender: source.SMS_SENDER ?? 'SPAADV',
    smsRoute: source.SMS_ROUTE ?? 'ServiceImplicit',
    smsBrand: source.SMS_BRAND ?? 'Spa Advisor',
    smsOtpTemplate: source.SMS_OTP_TEMPLATE ?? '',
    groupMemberLimit: integer('GROUP_MEMBER_LIMIT', 1000, 2, 10000),
    wsHeartbeatIntervalMs: integer(
      'WS_HEARTBEAT_INTERVAL_MS',
      30000,
      nodeEnv === 'test' ? 25 : 10000,
      60000,
    ),
    cleanupIntervalMs: integer('SESSION_CLEANUP_INTERVAL_MS', 3600000, 60000, 86400000),
    retentionWorkerIntervalMs: integer(
      'RETENTION_WORKER_INTERVAL_MS',
      300000,
      nodeEnv === 'test' ? 50 : 60000,
      86400000,
    ),
    retentionWorkerEnabled: ['1', 'true', 'TRUE', 'yes', 'YES'].includes(
      source.RETENTION_WORKER_ENABLED ?? '',
    ),
    s3Endpoint: String(source.S3_ENDPOINT ?? '').trim(),
    s3PublicEndpoint:
      String(source.S3_PUBLIC_ENDPOINT ?? '').trim() || String(source.S3_ENDPOINT ?? '').trim(),
    s3Region: String(source.S3_REGION ?? 'us-east-1').trim() || 'us-east-1',
    s3Bucket: String(source.S3_BUCKET ?? 'company-chat').trim() || 'company-chat',
    s3AccessKey: source.S3_ACCESS_KEY ?? '',
    s3SecretKey: source.S3_SECRET_KEY ?? '',
    s3ForcePathStyle:
      source.S3_FORCE_PATH_STYLE === 'false' || source.S3_FORCE_PATH_STYLE === '0'
        ? false
        : source.S3_FORCE_PATH_STYLE === 'true' || source.S3_FORCE_PATH_STYLE === '1'
          ? true
          : Boolean(String(source.S3_ENDPOINT ?? '').trim()),
    s3CreateBucket:
      source.S3_CREATE_BUCKET === '1' || source.S3_CREATE_BUCKET === 'true'
        ? true
        : source.S3_CREATE_BUCKET === '0' || source.S3_CREATE_BUCKET === 'false'
          ? false
          : nodeEnv !== 'production',
    s3UploadTtlSeconds: integer('S3_UPLOAD_TTL_SECONDS', 900, 30, 3600),
    s3DownloadTtlSeconds: integer('S3_DOWNLOAD_TTL_SECONDS', 60, 15, 600),
    attachmentPendingTtlMs: integer('ATTACHMENT_PENDING_TTL_MS', 7200000, 60000, 86400000),
    attachmentDailyQuotaBytes: integer(
      'ATTACHMENT_DAILY_QUOTA_BYTES',
      8589934592,
      1024 * 1024,
      10 * 1024 * 1024 * 1024,
    ),
    attachmentRateLimit: integer('ATTACHMENT_RATE_LIMIT', 60, 1, 1000),
    firebaseServiceAccountPath: source.FIREBASE_SERVICE_ACCOUNT_PATH ?? '',
    trustProxy: source.TRUST_PROXY === '1' || source.TRUST_PROXY === 'true',
    chatAttachmentsEnabled: flagEnabled(source.CHAT_ATTACHMENTS_ENABLED, nodeEnv !== 'production'),
    callsEnabled: flagEnabled(source.CALLS_ENABLED, nodeEnv !== 'production'),
    callTimeoutSeconds: integer('CALL_TIMEOUT_SECONDS', 45, 10, 120),
    callConnectTimeoutSeconds: integer('CALL_CONNECT_TIMEOUT_SECONDS', 60, 10, 180),
    callRateLimit: integer('CALL_RATE_LIMIT', 20, 1, 1000),
    callSweepIntervalMs: integer(
      'CALL_SWEEP_INTERVAL_MS',
      nodeEnv === 'test' ? 200 : 5000,
      nodeEnv === 'test' ? 50 : 1000,
      60000,
    ),
    stunUrls: source.STUN_URLS ?? '',
    turnUrls: source.TURN_URLS ?? '',
    turnSecret: source.TURN_SECRET ?? '',
    turnRealm: source.TURN_REALM ?? 'michat',
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
  try {
    const url = new URL(config.smsApiUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    errors.push('SMS_API_URL must be an HTTP(S) URL');
  }
  if (!config.smsSender.trim() || !config.smsRoute.trim()) {
    errors.push('SMS sender and route must not be empty');
  }
  if (!config.smsBrand.trim()) {
    errors.push('SMS_BRAND must not be empty');
  }
  if (config.smsOtpTemplate && !config.smsOtpTemplate.includes('{code}')) {
    errors.push('SMS_OTP_TEMPLATE must include the {code} placeholder');
  }
  if (nodeEnv === 'production') {
    if (!config.smsUsername.trim() || !config.smsApiKey.trim() || !config.smsTemplateId.trim()) {
      errors.push('Production SMS username, API key and template ID are required');
    }
    if (!config.s3AccessKey.trim() || !config.s3SecretKey.trim() || !config.s3Bucket.trim()) {
      errors.push('Production S3 credentials and bucket are required');
    }
  }
  for (const [key, value] of [
    ['S3_ENDPOINT', config.s3Endpoint],
    ['S3_PUBLIC_ENDPOINT', config.s3PublicEndpoint],
  ]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      errors.push(`${key} must be an HTTP(S) URL when set`);
    }
  }
  if (!config.host.trim()) errors.push('HOST must not be empty');
  if (errors.length) throw new Error(`Invalid environment: ${errors.join('; ')}`);
  return Object.freeze(config);
}
