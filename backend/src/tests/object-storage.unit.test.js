import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnv } from '../config/env.js';
import {
  createS3ClientOptions,
  manageBucketOnStartup,
  objectStorage,
  s3ClientSettings,
} from '../services/object-storage.service.js';
import { attachmentsService } from '../modules/attachments/attachments.service.js';
import { MULTIPART_PART_SIZE, planUpload } from '../services/upload-plan.js';

const secret = 'foundation-test-only-secret-'.repeat(4);
const awsProduction = {
  JWT_SECRET: secret,
  DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
  NODE_ENV: 'production',
  SMS_USERNAME: 'user',
  SMS_API_KEY: 'key',
  SMS_TEMPLATE_ID: 'tmpl',
  CORS_ORIGINS: 'https://web.michat.in',
  S3_ENDPOINT: '',
  S3_PUBLIC_ENDPOINT: '',
  S3_REGION: 'ap-south-1',
  S3_BUCKET: 'michat-main-bucket',
  S3_ACCESS_KEY: 'AKIATESTEXAMPLE',
  S3_SECRET_KEY: 'test-only-secret',
  S3_FORCE_PATH_STYLE: 'false',
  S3_CREATE_BUCKET: 'false',
  CHAT_ATTACHMENTS_ENABLED: 'false',
  CALLS_ENABLED: 'false',
};

function hostOnly(url) {
  const parsed = new URL(url);
  return { protocol: parsed.protocol, hostname: parsed.hostname, pathname: parsed.pathname };
}

test('blank AWS endpoints use the SDK regional client and virtual-hosted addressing', () => {
  const config = loadEnv(awsProduction);
  assert.equal(config.s3Endpoint, '');
  assert.equal(config.s3PublicEndpoint, '');
  assert.equal(config.s3Region, 'ap-south-1');
  assert.equal(config.s3ForcePathStyle, false);
  assert.equal(config.s3CreateBucket, false);
  assert.equal(config.chatAttachmentsEnabled, false);
  assert.equal(config.callsEnabled, false);

  const settings = s3ClientSettings(config);
  assert.equal(settings.enabled, true);
  assert.equal(settings.endpoint, undefined);
  assert.equal(settings.publicEndpoint, undefined);
  assert.equal(settings.forcePathStyle, false);

  const options = createS3ClientOptions(config, { publicEndpoint: true });
  assert.equal(Object.hasOwn(options, 'endpoint'), false);
  assert.equal(options.region, 'ap-south-1');
  assert.equal(options.forcePathStyle, false);
});

test('S3_FORCE_PATH_STYLE=false and S3_CREATE_BUCKET=0 are accepted for AWS', () => {
  const config = loadEnv({
    ...awsProduction,
    S3_FORCE_PATH_STYLE: 'false',
    S3_CREATE_BUCKET: '0',
  });
  assert.equal(config.s3ForcePathStyle, false);
  assert.equal(config.s3CreateBucket, false);
});

test('custom S3 endpoints still default to path-style addressing', () => {
  const config = loadEnv({
    JWT_SECRET: secret,
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
    NODE_ENV: 'test',
    S3_ENDPOINT: 'http://storage:4566',
    S3_ACCESS_KEY: 'local',
    S3_SECRET_KEY: 'local-secret',
  });
  assert.equal(config.s3ForcePathStyle, true);
  const options = createS3ClientOptions(config);
  assert.equal(options.endpoint, 'http://storage:4566');
  assert.equal(options.forcePathStyle, true);
});

test('presigned PUT and GET target the AWS virtual-hosted host without a custom endpoint', async () => {
  const storage = objectStorage(loadEnv(awsProduction));
  assert.equal(storage.enabled, true);
  const upload = hostOnly(await storage.presignUpload('att/2026/11/example', 'image/png', 60));
  assert.equal(upload.protocol, 'https:');
  assert.equal(upload.hostname, 'michat-main-bucket.s3.ap-south-1.amazonaws.com');
  assert.equal(upload.pathname, '/att/2026/11/example');
  const download = hostOnly(
    await storage.presignDownload('att/2026/11/example', {
      mimeType: 'image/png',
      fileName: 'pixel.png',
      inline: true,
      expiresIn: 60,
    }),
  );
  assert.equal(download.hostname, 'michat-main-bucket.s3.ap-south-1.amazonaws.com');
  const part = hostOnly(await storage.presignUploadPart('att/2026/11/example', 'upload-id', 1, 900));
  assert.equal(part.hostname, 'michat-main-bucket.s3.ap-south-1.amazonaws.com');
});

test('multipart is selected above 8 MiB and remains abortable in the client API', () => {
  const small = planUpload(1024);
  const large = planUpload(MULTIPART_PART_SIZE + 1);
  assert.equal(small.mode, 'single');
  assert.equal(large.mode, 'multipart');
  assert.equal(large.partSize, MULTIPART_PART_SIZE);
  const storage = objectStorage(loadEnv(awsProduction));
  assert.equal(typeof storage.createMultipartUpload, 'function');
  assert.equal(typeof storage.presignUploadPart, 'function');
  assert.equal(typeof storage.completeMultipart, 'function');
  assert.equal(typeof storage.abortMultipart, 'function');
});

test('CHAT_ATTACHMENTS_ENABLED=false blocks upload init even when S3 is configured', async () => {
  const config = loadEnv(awsProduction);
  const service = attachmentsService(
    { storage: objectStorage(config), database: { db: {} } },
    config,
  );
  await assert.rejects(() => service.init('conversation', 'user', { mimeType: 'image/png', sizeBytes: 12 }), (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, 'ATTACHMENTS_DISABLED');
    return true;
  });
});

test('text chat remains independent of S3 availability', () => {
  const storage = objectStorage({
    s3Endpoint: '',
    s3PublicEndpoint: '',
    s3Region: 'ap-south-1',
    s3Bucket: 'michat-main-bucket',
    s3AccessKey: '',
    s3SecretKey: '',
    s3ForcePathStyle: false,
  });
  assert.equal(storage.enabled, false);
});

function recordingClient(handler) {
  const commands = [];
  return {
    commands,
    send: async (command) => {
      const name = command.constructor.name;
      commands.push(name);
      return handler(name, command);
    },
  };
}

function accessDenied(name) {
  const error = new Error(`not authorized to perform ${name}`);
  error.name = 'AccessDenied';
  error.$metadata = { httpStatusCode: 403 };
  throw error;
}

test('production startup only heads the existing AWS bucket and never mutates CORS or lifecycle', async () => {
  const config = loadEnv(awsProduction);
  assert.equal(manageBucketOnStartup(config), false);
  const restricted = recordingClient((name) => {
    if (name === 'HeadBucketCommand') return {};
    return accessDenied(name);
  });
  const storage = objectStorage(config, undefined, {
    internalClient: restricted,
    publicClient: restricted,
  });
  const result = await storage.ensureBucket();
  assert.equal(result.status, 'connected');
  assert.deepEqual(restricted.commands, ['HeadBucketCommand']);
  assert.equal(await storage.ready(), 'connected');
});

test('restricted IAM AccessDenied on bucket admin APIs does not fail production startup', async () => {
  const config = loadEnv({ ...awsProduction, S3_CREATE_BUCKET: '0' });
  const restricted = recordingClient((name) => {
    if (name === 'HeadBucketCommand') return {};
    return accessDenied(name);
  });
  await assert.doesNotReject(() =>
    objectStorage(config, undefined, { internalClient: restricted }).ensureBucket(),
  );
  assert.equal(
    restricted.commands.some((name) =>
      ['PutBucketCorsCommand', 'PutBucketLifecycleConfigurationCommand', 'CreateBucketCommand'].includes(name),
    ),
    false,
  );
});

test('LocalStack still creates the bucket and applies CORS when S3_CREATE_BUCKET is enabled', async () => {
  const config = loadEnv({
    JWT_SECRET: secret,
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
    NODE_ENV: 'test',
    S3_ENDPOINT: 'http://storage:4566',
    S3_ACCESS_KEY: 'local',
    S3_SECRET_KEY: 'local-secret',
    S3_CREATE_BUCKET: 'true',
    CORS_ORIGINS: 'http://127.0.0.1:5173',
  });
  assert.equal(manageBucketOnStartup(config), true);
  const local = recordingClient((name) => {
    if (name === 'HeadBucketCommand') {
      const error = new Error('NotFound');
      error.name = 'NotFound';
      error.$metadata = { httpStatusCode: 404 };
      throw error;
    }
    return {};
  });
  await objectStorage(config, undefined, { internalClient: local }).ensureBucket();
  assert.deepEqual(local.commands, [
    'HeadBucketCommand',
    'CreateBucketCommand',
    'PutBucketCorsCommand',
    'PutBucketLifecycleConfigurationCommand',
  ]);
});
