import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnv } from '../config/env.js';
import { batchMessageType, presentAttachments, publicAttachment, attachmentsService } from '../modules/attachments/attachments.service.js';
import { MAX_ATTACHMENT_BATCH, MAX_PENDING_UPLOADS } from '../services/upload-plan.js';
import { createStorageKey } from '../services/object-storage.service.js';

const secret = 'foundation-test-only-secret-'.repeat(4);

test('publicAttachment never includes storage keys or bucket paths', () => {
  const presented = publicAttachment({
    id: '11111111-1111-1111-1111-111111111111',
    originalName: 'pixel.png',
    mimeType: 'image/png',
    sizeBytes: 67,
    kind: 'image',
    status: 'available',
    checksumSha256: 'abc',
    storageKey: 'att/2026/11/should-not-leak',
    multipartUploadId: 'upload-id',
    createdAt: new Date('2026-11-10T12:12:14.000Z'),
  });
  assert.equal(presented.storageKey, undefined);
  assert.equal(presented.multipartUploadId, undefined);
  assert.equal(presented.originalName, undefined);
  assert.equal(presented.displayName, 'MiChat Image 2026-11-10 at 5.42.14 PM.png');
  assert.equal(JSON.stringify(presented).includes('att/'), false);
  assert.equal(JSON.stringify(presented).includes('pixel.png'), false);
  assert.equal(presented.status, 'available');
});

test('presentAttachments preserves order and keeps a legacy singular attachment', () => {
  const presented = presentAttachments([
    { id: 'a', originalName: 'one.png', mimeType: 'image/png', sizeBytes: 1, kind: 'image', status: 'available', sortOrder: 0 },
    { id: 'b', originalName: 'two.png', mimeType: 'image/png', sizeBytes: 1, kind: 'image', status: 'available', sortOrder: 1 },
  ]);
  assert.equal(presented.attachment.id, 'a');
  assert.equal(presented.attachments.map((row) => row.id).join(','), 'a,b');
  assert.equal(batchMessageType(['image', 'image']), 'image');
  assert.equal(batchMessageType(['image', 'video']), 'file');
  assert.equal(MAX_ATTACHMENT_BATCH, 50);
  assert.equal(MAX_PENDING_UPLOADS, 60);
});

test('attachment objects use the att/ prefix rather than the smoke-test prefix', () => {
  const key = createStorageKey();
  assert.equal(key.startsWith('att/'), true);
  assert.equal(key.startsWith('michat-smoke-test/'), false);
});

test('production keeps chat attachments and calling off unless explicitly enabled', () => {
  const config = loadEnv({
    JWT_SECRET: secret,
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
    NODE_ENV: 'production',
    SMS_USERNAME: 'user',
    SMS_API_KEY: 'key',
    SMS_TEMPLATE_ID: 'tmpl',
    CORS_ORIGINS: 'https://web.michat.in',
    S3_BUCKET: 'michat-main-bucket',
    S3_REGION: 'ap-south-1',
    S3_ACCESS_KEY: 'AKIATESTEXAMPLE',
    S3_SECRET_KEY: 'test-only-secret',
    S3_FORCE_PATH_STYLE: 'false',
    S3_CREATE_BUCKET: 'false',
  });
  assert.equal(config.chatAttachmentsEnabled, false);
  assert.equal(config.callsEnabled, false);
});

test('isolated tests can enable attachments without enabling calling', () => {
  const config = loadEnv({
    JWT_SECRET: secret,
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat_test',
    NODE_ENV: 'test',
    CHAT_ATTACHMENTS_ENABLED: 'true',
    CALLS_ENABLED: 'false',
  });
  assert.equal(config.chatAttachmentsEnabled, true);
  assert.equal(config.callsEnabled, false);
});

test('unconfigured storage still blocks attachment writes', async () => {
  const config = loadEnv({
    JWT_SECRET: secret,
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat_test',
    NODE_ENV: 'test',
    CHAT_ATTACHMENTS_ENABLED: 'true',
    CALLS_ENABLED: 'false',
  });
  const service = attachmentsService({ storage: { enabled: false }, database: { db: {} } }, config);
  await assert.rejects(
    () => service.init('conversation', 'user', { mimeType: 'image/png', sizeBytes: 12 }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, 'STORAGE_UNAVAILABLE');
      return true;
    },
  );
});
