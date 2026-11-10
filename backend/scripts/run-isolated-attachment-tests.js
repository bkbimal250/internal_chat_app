import { spawnSync } from 'node:child_process';
import { loadEnv } from '../src/config/env.js';
import { applyMigrations } from '../src/database/migrate.js';

const PRODUCTION_BUCKETS = new Set(['michat-main-bucket']);
const AWS_ENDPOINT = /amazonaws\.com/i;
const PRODUCTION_HOST = /(michat\.in|amazonaws\.com)$/i;
const ISOLATED_SECRET = 'isolated-multi-file-test-secret-value-do-not-use-in-prod-64chars!!';
const DEFAULT_DATABASE_URL =
  'postgresql://chat:isolated-test-only-password@127.0.0.1:55432/company_chat_test';
const DEFAULT_S3_ENDPOINT = 'http://127.0.0.1:14566';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const requestedUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
let databaseUrl;
try {
  databaseUrl = new URL(requestedUrl);
} catch {
  fail('Refusing to run: DATABASE_URL must be a PostgreSQL URL');
}
databaseUrl.pathname = databaseUrl.pathname.endsWith('_test') ? databaseUrl.pathname : '/company_chat_test';
if (!databaseUrl.pathname.endsWith('_test')) fail('Refusing to run: database name must end with _test');
if (PRODUCTION_HOST.test(databaseUrl.hostname) || databaseUrl.hostname === 'api.michat.in') {
  fail('Refusing to run: database host looks like production');
}
if (!['127.0.0.1', 'localhost', 'postgres'].includes(databaseUrl.hostname)) {
  fail('Refusing to run: isolated tests must use a local database host');
}

const bucket = process.env.S3_TEST_BUCKET || 'company-chat-test';
const endpoint = process.env.S3_ENDPOINT || DEFAULT_S3_ENDPOINT;
if (PRODUCTION_BUCKETS.has(bucket)) fail('Refusing to run: S3_TEST_BUCKET must not be michat-main-bucket');
if (!endpoint) fail('Refusing to run: S3_ENDPOINT is required for isolated LocalStack tests');
if (AWS_ENDPOINT.test(endpoint) || /s3[.-][a-z0-9-]+\.amazonaws/i.test(endpoint)) {
  fail('Refusing to run: AWS S3 endpoints are not allowed');
}

const isolatedEnv = {
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: process.env.LOG_LEVEL || 'silent',
  JWT_SECRET: process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 64 ? process.env.JWT_SECRET : ISOLATED_SECRET,
  DATABASE_URL: databaseUrl.href,
  TEST_DATABASE_URL: databaseUrl.href,
  S3_ENDPOINT: endpoint,
  S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT || endpoint,
  S3_BUCKET: bucket,
  S3_TEST_BUCKET: bucket,
  S3_ACCESS_KEY: 'test',
  S3_SECRET_KEY: 'test',
  S3_REGION: process.env.S3_REGION || 'us-east-1',
  S3_FORCE_PATH_STYLE: 'true',
  S3_CREATE_BUCKET: 'true',
  CHAT_ATTACHMENTS_ENABLED: 'true',
};

process.stdout.write(
  JSON.stringify({
    database: databaseUrl.pathname.slice(1),
    databaseHost: databaseUrl.hostname,
    s3Endpoint: isolatedEnv.S3_ENDPOINT,
    s3PublicEndpoint: isolatedEnv.S3_PUBLIC_ENDPOINT === isolatedEnv.S3_ENDPOINT ? 'same-as-endpoint' : 'custom',
    s3Bucket: bucket,
    attachmentsEnabled: isolatedEnv.CHAT_ATTACHMENTS_ENABLED,
  }) + '\n',
);

await applyMigrations(loadEnv(isolatedEnv));
const files = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    ...(files.length
      ? files
      : [
          'src/tests/michat-filename.test.js',
          'src/tests/phase5-attachments.integration.test.js',
          'src/tests/typing.integration.test.js',
          'src/tests/feature-flags.integration.test.js',
          'src/tests/attachments.unit.test.js',
          'src/tests/object-storage.unit.test.js',
          'src/tests/profile-photos.integration.test.js',
        ]),
  ],
  {
    stdio: 'inherit',
    env: isolatedEnv,
  },
);
process.exit(result.status ?? 1);
