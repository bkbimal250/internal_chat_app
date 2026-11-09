import { spawnSync } from 'node:child_process';
import { loadEnv } from '../src/config/env.js';
import { applyMigrations } from '../src/database/migrate.js';

const PRODUCTION_BUCKETS = new Set(['michat-main-bucket']);
const AWS_ENDPOINT = /amazonaws\.com/i;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const config = loadEnv();
const databaseUrl = new URL(config.databaseUrl);
databaseUrl.pathname = '/company_chat_test';
if (!databaseUrl.pathname.endsWith('_test')) fail('Refusing to run: database name must end with _test');
if (databaseUrl.hostname === 'api.michat.in' || /michat\.in$/i.test(databaseUrl.hostname)) {
  fail('Refusing to run: database host looks like production');
}

const bucket = process.env.S3_TEST_BUCKET || process.env.S3_BUCKET || 'company-chat-test';
const endpoint = process.env.S3_ENDPOINT || '';
if (PRODUCTION_BUCKETS.has(bucket)) fail('Refusing to run: S3_TEST_BUCKET must not be michat-main-bucket');
if (!endpoint) fail('Refusing to run: S3_ENDPOINT is required for isolated LocalStack tests');
if (AWS_ENDPOINT.test(endpoint) || /s3[.-][a-z0-9-]+\.amazonaws/i.test(endpoint)) {
  fail('Refusing to run: AWS S3 endpoints are not allowed');
}

const isolatedEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl.href,
  TEST_DATABASE_URL: databaseUrl.href,
  S3_ENDPOINT: endpoint,
  S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT || endpoint,
  S3_BUCKET: bucket,
  S3_TEST_BUCKET: bucket,
  S3_REGION: process.env.S3_REGION || 'us-east-1',
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE || 'true',
  S3_CREATE_BUCKET: process.env.S3_CREATE_BUCKET || 'true',
  CHAT_ATTACHMENTS_ENABLED: 'true',
  CALLS_ENABLED: 'false',
  NODE_ENV: process.env.NODE_ENV || 'test',
};

process.stdout.write(
  JSON.stringify({
    database: databaseUrl.pathname.slice(1),
    databaseHost: databaseUrl.hostname,
    s3Endpoint: isolatedEnv.S3_ENDPOINT,
    s3PublicEndpoint: isolatedEnv.S3_PUBLIC_ENDPOINT === isolatedEnv.S3_ENDPOINT ? 'same-as-endpoint' : 'custom',
    s3Bucket: bucket,
    attachmentsEnabled: isolatedEnv.CHAT_ATTACHMENTS_ENABLED,
    callsEnabled: isolatedEnv.CALLS_ENABLED,
  }) + '\n',
);

await applyMigrations(loadEnv(isolatedEnv));
const result = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'src/tests/phase5-attachments.integration.test.js',
    'src/tests/feature-flags.integration.test.js',
    'src/tests/attachments.unit.test.js',
    'src/tests/object-storage.unit.test.js',
    'src/tests/profile-photos.integration.test.js',
  ],
  {
    stdio: 'inherit',
    env: isolatedEnv,
  },
);
process.exit(result.status ?? 1);
