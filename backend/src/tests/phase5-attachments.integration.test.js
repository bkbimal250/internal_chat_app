import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import WebSocket from 'ws';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { attachments, users } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';
import { cleanupAttachments } from '../jobs/attachment-cleanup.job.js';
import { unzipEntries } from './helpers/unzip-entries.js';

const PRODUCTION_BUCKETS = new Set(['michat-main-bucket']);
const testUrl = process.env.TEST_DATABASE_URL;
const s3Endpoint = process.env.S3_ENDPOINT;
const dbReady = Boolean(testUrl && new URL(testUrl).pathname.endsWith('_test'));
const storageReady = Boolean(s3Endpoint && process.env.S3_ACCESS_KEY);
const enabled = dbReady && storageReady;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0xff, 0xd9,
]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

function isolatedBucket() {
  const bucket = process.env.S3_TEST_BUCKET || 'company-chat-test';
  if (PRODUCTION_BUCKETS.has(bucket)) {
    throw new Error('Refusing attachment integration tests against the production bucket');
  }
  return bucket;
}

function assertStatus(response, expected) {
  assert.equal(response.statusCode, expected);
}

function assertSignedUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
    assert.equal(typeof value, 'string', 'expected a signed HTTP URL');
    assert.fail('expected a signed HTTP URL');
  }
  let signed = false;
  try {
    const parsed = new URL(value);
    signed = Boolean(
      parsed.searchParams.get('X-Amz-Signature') ||
        parsed.searchParams.get('X-Amz-Credential') ||
        parsed.searchParams.get('Signature'),
    );
  } catch {
    assert.fail('expected a signed HTTP URL');
  }
  assert.equal(signed, true, 'expected a signed query without logging the URL');
}

function unsignedObjectUrl(signedUrl) {
  const parsed = new URL(signedUrl);
  return `${parsed.origin}${parsed.pathname}`;
}

function withoutPresignedUrls(payload) {
  const copy = { ...payload };
  delete copy.uploadUrl;
  delete copy.url;
  if (Array.isArray(copy.parts)) {
    copy.parts = copy.parts.map((part) => {
      const next = { ...part };
      delete next.uploadUrl;
      return next;
    });
  }
  if (copy.attachment) {
    const attachment = { ...copy.attachment };
    delete attachment.storageKey;
    copy.attachment = attachment;
  }
  if (Array.isArray(copy.attachments)) {
    copy.attachments = copy.attachments.map((file) => {
      const attachment = { ...file };
      delete attachment.storageKey;
      return attachment;
    });
  }
  return copy;
}

function assertNoSecrets(payload, config) {
  const serialized = JSON.stringify(withoutPresignedUrls(payload));
  assert.equal(serialized.includes(config.s3SecretKey), false);
  assert.equal(Boolean(payload.attachment?.storageKey), false);
}

const waitEvent = (socket, event, predicate = () => true) =>
  new Promise((resolve, reject) => {
    const match = (message) => message.event === event && predicate(message);
    const existing = socket.chatEvents.find(match);
    if (existing) return resolve(existing);
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`Timed out waiting for ${event}`));
    }, 8000);
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (!match(message)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });

const open = async (url, token) => {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  socket.chatEvents = [];
  socket.on('message', (raw) => socket.chatEvents.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await waitEvent(socket, 'connection.ready');
  return socket;
};

test(
  'Phase 5: secure media uploads, membership, validation, cleanup and realtime',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test and S3_ENDPOINT' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'phase-five-secret-'.repeat(4),
      CORS_ORIGINS: 'http://127.0.0.1:5173',
      S3_ENDPOINT: s3Endpoint,
      S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT || s3Endpoint,
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
      S3_SECRET_KEY: process.env.S3_SECRET_KEY,
      S3_BUCKET: isolatedBucket(),
      S3_REGION: process.env.S3_REGION || 'us-east-1',
      S3_FORCE_PATH_STYLE: 'true',
      S3_CREATE_BUCKET: 'true',
      ATTACHMENT_PENDING_TTL_MS: '60000',
      ATTACHMENT_RATE_LIMIT: '1000',
      CHAT_ATTACHMENTS_ENABLED: 'true',
      CALLS_ENABLED: 'false',
    });
    assert.equal(config.chatAttachmentsEnabled, true);
    assert.equal(config.callsEnabled, false);
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.storage.ensureBucket();
    await app.database.db.execute(
      sql`truncate table attachments, audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );
    const password = 'Phase-Five-Password-9!';
    const hash = await hashPassword(password);
    const [owner, peer, stranger] = await app.database.db
      .insert(users)
      .values(
        ['media-a', 'media-b', 'media-c'].map((username) => ({
          username,
          displayName: username,
          passwordHash: hash,
          mustChangePassword: false,
        })),
      )
      .returning();
    const auth = authService(app, config);
    const login = (user, device) =>
      auth.login(
        { username: user.username, password, clientType: 'native', platform: 'android', deviceName: device },
        { ip: '127.0.0.1' },
      );
    const sessionA = await login(owner, 'a1');
    const sessionA2 = await login(owner, 'a2');
    const sessionB = await login(peer, 'b1');
    const sessionC = await login(stranger, 'c1');
    const token = (result) => accessToken(app, result.user, result.session);
    const header = (result) => ({ authorization: `Bearer ${token(result)}` });
    const conversation = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/direct',
      headers: header(sessionA),
      payload: { userId: peer.id },
    });
    assertStatus(conversation, 201);
    const conversationId = conversation.json().id;
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const wsUrl = address.replace('http', 'ws') + '/api/v1/ws';
    const socketA = await open(wsUrl, token(sessionA));
    const socketA2 = await open(wsUrl, token(sessionA2));
    const socketB = await open(wsUrl, token(sessionB));
    t.after(() => {
      socketA.close();
      socketA2.close();
      socketB.close();
    });

    const ready = await app.inject('/health/ready');
    assertStatus(ready, 200);
    assert.equal(ready.json().attachmentsEnabled, true);
    assert.equal(ready.json().callsEnabled, false);

    const text = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: header(sessionA),
      payload: { clientMessageId: randomUUID(), content: 'text still works with S3' },
    });
    assertStatus(text, 201);
    assert.equal(text.json().messageType, 'text');

    const init = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: { fileName: 'pixel.png', mimeType: 'image/png', sizeBytes: PNG.length },
    });
    assertStatus(init, 201);
    assertSignedUrl(init.json().uploadUrl);
    assertNoSecrets(init.json(), config);
    const pendingUrl = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${init.json().id}/url`,
      headers: header(sessionB),
    });
    assertStatus(pendingUrl, 404);

    const uploaded = await fetch(init.json().uploadUrl, {
      method: 'PUT',
      headers: init.json().headers,
      body: PNG,
    });
    assert.ok(uploaded.ok, `presigned PUT failed ${uploaded.status}`);

    const finalized = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${init.json().id}/finalize`,
      headers: header(sessionA),
      payload: { clientMessageId: randomUUID(), caption: 'team photo' },
    });
    assertStatus(finalized, 201);
    assert.equal(finalized.json().messageType, 'image');
    assert.equal(finalized.json().attachment.status, 'available');
    assertNoSecrets(finalized.json(), config);

    const created = await waitEvent(socketB, 'message.created', (event) => event.data.id === finalized.json().id);
    assert.equal(created.data.attachment.mimeType, 'image/png');
    const mirrored = await waitEvent(socketA2, 'message.created', (event) => event.data.id === finalized.json().id);
    assert.equal(mirrored.data.attachment.id, finalized.json().attachment.id);

    const download = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${finalized.json().attachment.id}/url`,
      headers: header(sessionB),
    });
    assertStatus(download, 200);
    assert.equal(download.json().inline, true);
    assertSignedUrl(download.json().url);
    const object = await fetch(download.json().url);
    assert.ok(object.ok);
    assert.equal(Buffer.from(await object.arrayBuffer()).equals(PNG), true);

    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${finalized.json().attachment.id}/url`,
    });
    assertStatus(anonymous, 401);

    const naked = await fetch(unsignedObjectUrl(download.json().url));
    const localStack = Boolean(s3Endpoint) && !/amazonaws\.com/i.test(String(s3Endpoint));
    if (localStack) {
      // LocalStack community does not emulate AWS Block Public Access unless ENFORCE_IAM is on.
      assert.ok([200, 401, 403, 404].includes(naked.status));
    } else {
      assert.ok([401, 403, 404].includes(naked.status), `unsigned object GET returned ${naked.status}`);
    }

    const saveUrl = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${finalized.json().attachment.id}/url?download=true`,
      headers: header(sessionB),
    });
    assertStatus(saveUrl, 200);
    assert.equal(saveUrl.json().inline, false);
    assertSignedUrl(saveUrl.json().url);

    const multiInit = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: {
        fileName: 'pixel-multi.png',
        mimeType: 'image/png',
        sizeBytes: PNG.length,
        strategy: 'multipart',
      },
    });
    assertStatus(multiInit, 201);
    assert.equal(multiInit.json().mode, 'multipart');
    assert.equal(Boolean(multiInit.json().uploadUrl), false);
    const signed = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${multiInit.json().id}/parts`,
      headers: header(sessionA),
      payload: { partNumbers: [1] },
    });
    assertStatus(signed, 200);
    assertSignedUrl(signed.json().parts[0].uploadUrl);
    const partPut = await fetch(signed.json().parts[0].uploadUrl, { method: 'PUT', body: PNG });
    assert.ok(partPut.ok, `part PUT failed ${partPut.status}`);
    const etag = partPut.headers.get('etag');
    assert.ok(etag);
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${multiInit.json().id}/parts`,
      headers: header(sessionA),
    });
    assertStatus(listed, 200);
    assert.equal(listed.json().parts.length, 1);
    const multiFinal = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${multiInit.json().id}/finalize`,
      headers: header(sessionA),
      payload: { clientMessageId: randomUUID(), parts: [{ partNumber: 1, etag }] },
    });
    assertStatus(multiFinal, 201);
    assert.equal(multiFinal.json().attachment.status, 'available');
    const multiFinalRetry = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${multiInit.json().id}/finalize`,
      headers: header(sessionA),
      payload: { clientMessageId: randomUUID() },
    });
    assertStatus(multiFinalRetry, 200);
    assert.equal(multiFinalRetry.json().duplicate, true);
    assert.equal(multiFinalRetry.json().id, multiFinal.json().id);

    const abortInit = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: {
        fileName: 'pixel-abort.png',
        mimeType: 'image/png',
        sizeBytes: PNG.length,
        strategy: 'multipart',
      },
    });
    assertStatus(abortInit, 201);
    const abortParts = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${abortInit.json().id}/parts`,
      headers: header(sessionA),
      payload: { partNumbers: [1] },
    });
    assertStatus(abortParts, 200);
    await fetch(abortParts.json().parts[0].uploadUrl, { method: 'PUT', body: PNG });
    const aborted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/attachments/${abortInit.json().id}`,
      headers: header(sessionA),
    });
    assertStatus(aborted, 200);
    const abortFinalize = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${abortInit.json().id}/finalize`,
      headers: header(sessionA),
      payload: { clientMessageId: randomUUID() },
    });
    assertStatus(abortFinalize, 409);

    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${finalized.json().attachment.id}/url`,
      headers: header(sessionC),
    });
    assertStatus(denied, 404);

    const outsiderInit = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionC),
      payload: { fileName: 'secret.png', mimeType: 'image/png', sizeBytes: PNG.length },
    });
    assertStatus(outsiderInit, 404);

    const group = await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: header(sessionA),
      payload: { title: 'Media group' },
    });
    assertStatus(group, 201);
    const groupId = group.json().id;
    const invited = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/members`,
      headers: header(sessionA),
      payload: { userId: peer.id },
    });
    assertStatus(invited, 201);
    const groupOutsider = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${groupId}/attachments`,
      headers: header(sessionC),
      payload: { fileName: 'group-secret.png', mimeType: 'image/png', sizeBytes: PNG.length },
    });
    assertStatus(groupOutsider, 404);
    const groupInit = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${groupId}/attachments`,
      headers: header(sessionB),
      payload: { fileName: 'group.png', mimeType: 'image/png', sizeBytes: PNG.length },
    });
    assertStatus(groupInit, 201);
    assertSignedUrl(groupInit.json().uploadUrl);
    const groupPut = await fetch(groupInit.json().uploadUrl, {
      method: 'PUT',
      headers: groupInit.json().headers,
      body: PNG,
    });
    assert.ok(groupPut.ok, `group presigned PUT failed ${groupPut.status}`);
    const groupFinal = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${groupInit.json().id}/finalize`,
      headers: header(sessionB),
      payload: { clientMessageId: randomUUID(), caption: 'group photo' },
    });
    assertStatus(groupFinal, 201);
    const groupDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${groupFinal.json().attachment.id}/url`,
      headers: header(sessionA),
    });
    assertStatus(groupDownload, 200);
    const groupDenied = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${groupFinal.json().attachment.id}/url`,
      headers: header(sessionC),
    });
    assertStatus(groupDenied, 404);

    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: { fileName: 'payload.exe', mimeType: 'application/x-msdownload', sizeBytes: 100 },
    });
    assertStatus(invalid, 415);

    const oversized = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: { fileName: 'huge.png', mimeType: 'image/png', sizeBytes: 26 * 1024 * 1024 },
    });
    assertStatus(oversized, 413);

    const mismatchInit = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: { fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: PNG.length },
    });
    assertStatus(mismatchInit, 201);
    await fetch(mismatchInit.json().uploadUrl, {
      method: 'PUT',
      headers: mismatchInit.json().headers,
      body: PNG,
    });
    const mismatch = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${mismatchInit.json().id}/finalize`,
      headers: header(sessionA),
      payload: { clientMessageId: randomUUID() },
    });
    assertStatus(mismatch, 415);

    const cancelledInit = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: { fileName: 'draft.png', mimeType: 'image/png', sizeBytes: PNG.length },
    });
    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/api/v1/attachments/${cancelledInit.json().id}`,
      headers: header(sessionA),
    });
    assertStatus(cancelled, 200);
    const cancelledFinalize = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${cancelledInit.json().id}/finalize`,
      headers: header(sessionA),
      payload: { clientMessageId: randomUUID() },
    });
    assertStatus(cancelledFinalize, 409);

    const abandoned = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: { fileName: 'old.png', mimeType: 'image/png', sizeBytes: PNG.length },
    });
    await app.database.db
      .update(attachments)
      .set({ uploadExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(attachments.id, abandoned.json().id));
    await cleanupAttachments(app);
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${abandoned.json().id}/finalize`,
      headers: header(sessionA),
      payload: { clientMessageId: randomUUID() },
    });
    assert.ok([409, 410, 404].includes(stale.statusCode));

    const tooMany = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments/complete`,
      headers: header(sessionA),
      payload: {
        clientMessageId: randomUUID(),
        items: Array.from({ length: 51 }, () => ({ id: randomUUID() })),
      },
    });
    assertStatus(tooMany, 400);

    async function putPending(name) {
      const started = await app.inject({
        method: 'POST',
        url: `/api/v1/conversations/${conversationId}/attachments`,
        headers: header(sessionA),
        payload: { fileName: name, mimeType: 'image/png', sizeBytes: PNG.length },
      });
      assertStatus(started, 201);
      const uploadedObject = await fetch(started.json().uploadUrl, {
        method: 'PUT',
        headers: started.json().headers,
        body: PNG,
      });
      assert.ok(uploadedObject.ok);
      return started.json();
    }
    const first = await putPending('album-1.png');
    const second = await putPending('album-2.png');
    const batchId = randomUUID();
    const batched = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments/complete`,
      headers: header(sessionA),
      payload: {
        clientMessageId: batchId,
        caption: 'two photos',
        items: [{ id: first.id }, { id: second.id }],
      },
    });
    assertStatus(batched, 201);
    assert.equal(batched.json().attachments.length, 2);
    assert.equal(batched.json().attachments[0].id, first.id);
    assert.equal(batched.json().attachments[1].id, second.id);
    assert.equal(batched.json().attachment.id, first.id);
    assertNoSecrets(batched.json(), config);
    assert.equal(batched.json().attachment.originalName, undefined);
    assert.equal(String(batched.json().attachment.displayName).startsWith('MiChat '), true);
    assert.equal(JSON.stringify(batched.json()).includes('album-1.png'), false);
    const zip = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments/zip`,
      headers: header(sessionB),
      payload: { ids: [first.id, second.id] },
    });
    assertStatus(zip, 200);
    assert.equal(String(zip.headers['content-type'] || '').includes('zip'), true);
    assert.equal(Number(zip.headers['x-archive-bytes']) > 0, true);
    const zipBytes = Buffer.from(zip.rawPayload || zip.payload || []);
    assert.equal(zipBytes.subarray(0, 2).toString(), 'PK');
    assert.equal(zipBytes.includes(Buffer.from('MiChat Image')), true);
    assert.equal(zipBytes.includes(Buffer.from('album-1.png')), false);
    const unzippedPair = unzipEntries(zipBytes);
    assert.equal(unzippedPair.length, 2);
    assert.equal(unzippedPair.every((entry) => entry.data.equals(PNG)), true);
    assert.equal(unzippedPair.every((entry) => entry.name.startsWith('MiChat Image')), true);
    const zipForbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments/zip`,
      headers: header(sessionB),
      payload: { ids: [randomUUID()] },
    });
    assertStatus(zipForbidden, 403);
    const batchEvent = await waitEvent(socketB, 'message.created', (event) => event.data.id === batched.json().id);
    assert.equal(batchEvent.data.attachments.length, 2);
    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments/complete`,
      headers: header(sessionA),
      payload: {
        clientMessageId: batchId,
        items: [{ id: first.id }, { id: second.id }],
      },
    });
    assertStatus(replay, 200);
    assert.equal(replay.json().duplicate, true);
    assert.equal(replay.json().id, batched.json().id);
    const outsider = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${first.id}/url`,
    });
    assertStatus(outsider, 401);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/attachments/${finalized.json().attachment.id}`,
      headers: header(sessionA),
    });
    assertStatus(removed, 200);
    const gone = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${finalized.json().attachment.id}/url`,
      headers: header(sessionB),
    });
    assertStatus(gone, 404);
  },
);

function mixedUpload(index) {
  if (index < 30) {
    return { originalName: `secret-photo-${index}.png`, mimeType: 'image/png', body: PNG };
  }
  if (index < 40) {
    return { originalName: `secret-scan-${index}.jpg`, mimeType: 'image/jpeg', body: JPEG };
  }
  if (index < 45) {
    return { originalName: `secret-contract-${index}.pdf`, mimeType: 'application/pdf', body: PDF };
  }
  return {
    originalName: `secret-notes-${index}.txt`,
    mimeType: 'text/plain',
    body: Buffer.from(`confidential notes ${index}\nline two\n`),
  };
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

test(
  'Phase 5: fifty mixed multipart uploads zip with original bytes and MiChat names',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test and S3_ENDPOINT' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'phase-five-fifty-secret-'.repeat(3),
      CORS_ORIGINS: 'http://127.0.0.1:5173',
      S3_ENDPOINT: s3Endpoint,
      S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT || s3Endpoint,
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
      S3_SECRET_KEY: process.env.S3_SECRET_KEY,
      S3_BUCKET: isolatedBucket(),
      S3_REGION: process.env.S3_REGION || 'us-east-1',
      S3_FORCE_PATH_STYLE: 'true',
      S3_CREATE_BUCKET: 'true',
      ATTACHMENT_PENDING_TTL_MS: '60000',
      ATTACHMENT_RATE_LIMIT: '1000',
      CHAT_ATTACHMENTS_ENABLED: 'true',
      CALLS_ENABLED: 'false',
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.storage.ensureBucket();
    await app.database.db.execute(
      sql`truncate table attachments, audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );
    const password = 'Phase-Five-Fifty-9!';
    const hash = await hashPassword(password);
    const [owner, peer, stranger] = await app.database.db
      .insert(users)
      .values(
        ['fifty-a', 'fifty-b', 'fifty-c'].map((username) => ({
          username,
          displayName: username,
          passwordHash: hash,
          mustChangePassword: false,
        })),
      )
      .returning();
    const auth = authService(app, config);
    const login = (user, device) =>
      auth.login(
        { username: user.username, password, clientType: 'native', platform: 'android', deviceName: device },
        { ip: '127.0.0.1' },
      );
    const sessionA = await login(owner, 'a1');
    const sessionB = await login(peer, 'b1');
    const sessionC = await login(stranger, 'c1');
    const token = (result) => accessToken(app, result.user, result.session);
    const header = (result) => ({ authorization: `Bearer ${token(result)}` });
    const conversation = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/direct',
      headers: header(sessionA),
      payload: { userId: peer.id },
    });
    assertStatus(conversation, 201);
    const conversationId = conversation.json().id;

    const pending = await mapPool(Array.from({ length: 50 }, (_, index) => index), 5, async (index) => {
      const spec = mixedUpload(index);
      const started = await app.inject({
        method: 'POST',
        url: `/api/v1/conversations/${conversationId}/attachments`,
        headers: header(sessionA),
        payload: {
          fileName: spec.originalName,
          mimeType: spec.mimeType,
          sizeBytes: spec.body.length,
          strategy: 'multipart',
        },
      });
      assertStatus(started, 201);
      assert.equal(started.json().mode, 'multipart');
      const signed = await app.inject({
        method: 'POST',
        url: `/api/v1/attachments/${started.json().id}/parts`,
        headers: header(sessionA),
        payload: { partNumbers: [1] },
      });
      assertStatus(signed, 200);
      const uploadUrl = signed.json().parts[0].uploadUrl;
      let uploaded = await fetch(uploadUrl, { method: 'PUT', body: spec.body });
      if (!uploaded.ok) uploaded = await fetch(uploadUrl, { method: 'PUT', body: spec.body });
      assert.ok(uploaded.ok, `multipart PUT failed ${uploaded.status}`);
      if (index === 0) {
        const retried = await fetch(uploadUrl, { method: 'PUT', body: spec.body });
        assert.ok(retried.ok, `multipart retry PUT failed ${retried.status}`);
      }
      return {
        id: started.json().id,
        etag: uploaded.headers.get('etag'),
        spec,
      };
    });

    const cancelledInit = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: { fileName: 'draft-cancel.png', mimeType: 'image/png', sizeBytes: PNG.length, strategy: 'multipart' },
    });
    assertStatus(cancelledInit, 201);
    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/api/v1/attachments/${cancelledInit.json().id}`,
      headers: header(sessionA),
    });
    assertStatus(cancelled, 200);
    const partial = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments/complete`,
      headers: header(sessionA),
      payload: {
        clientMessageId: randomUUID(),
        items: [{ id: pending[0].id, parts: [{ partNumber: 1, etag: pending[0].etag }] }, { id: cancelledInit.json().id }],
      },
    });
    assert.ok([404, 409].includes(partial.statusCode));

    const batched = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments/complete`,
      headers: header(sessionA),
      payload: {
        clientMessageId: randomUUID(),
        caption: 'fifty mixed files',
        items: pending.map((item) => ({ id: item.id, parts: [{ partNumber: 1, etag: item.etag }] })),
      },
    });
    assertStatus(batched, 201);
    const files = batched.json().attachments;
    assert.equal(files.length, 50);
    assert.equal(JSON.stringify(batched.json()).includes('secret-photo-'), false);
    assert.equal(JSON.stringify(batched.json()).includes('secret-notes-'), false);
    assert.equal(files.every((file) => String(file.displayName).startsWith('MiChat ')), true);
    assert.equal(files.every((file) => file.originalName === undefined), true);

    const zipUnauthorized = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments/zip`,
      payload: { ids: files.map((file) => file.id) },
    });
    assertStatus(zipUnauthorized, 401);
    const zipForbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments/zip`,
      headers: header(sessionC),
      payload: { ids: files.map((file) => file.id) },
    });
    assert.ok(
      [403, 404].includes(zipForbidden.statusCode),
      `outsider zip ${zipForbidden.statusCode} ${JSON.stringify(zipForbidden.json())}`,
    );

    const zip = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments/zip`,
      headers: header(sessionB),
      payload: { ids: files.map((file) => file.id) },
    });
    assertStatus(zip, 200);
    assert.equal(Number(zip.headers['x-archive-bytes']) > 0, true);
    const zipBytes = Buffer.from(zip.rawPayload || zip.payload || []);
    const extracted = unzipEntries(zipBytes);
    assert.equal(extracted.length, 50);
    const byName = new Map(extracted.map((entry) => [entry.name, entry]));
    assert.equal(byName.size, 50);
    for (const file of files) {
      const entry = byName.get(file.displayName);
      assert.ok(entry, `missing ZIP entry ${file.displayName}`);
      const uploaded = pending.find((item) => item.id === file.id);
      assert.equal(entry.data.equals(uploaded.spec.body), true);
      assert.equal(entry.name.includes(uploaded.spec.originalName), false);
    }
  },
);

test(
  'Phase 5: text chat works when attachments are on but S3 is unconfigured',
  { skip: !dbReady && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'phase-five-nos3-secret-'.repeat(3),
      CHAT_ATTACHMENTS_ENABLED: 'true',
      CALLS_ENABLED: 'false',
    });
    assert.equal(config.chatAttachmentsEnabled, true);
    assert.equal(config.s3AccessKey, '');
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table attachments, audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );
    const password = 'Phase-Five-NoS3-9!';
    const hash = await hashPassword(password);
    const [owner, peer] = await app.database.db
      .insert(users)
      .values([
        { username: 'nos3-a', displayName: 'NoS3 A', passwordHash: hash, mustChangePassword: false },
        { username: 'nos3-b', displayName: 'NoS3 B', passwordHash: hash, mustChangePassword: false },
      ])
      .returning();
    const auth = authService(app, config);
    const session = await auth.login(
      { username: owner.username, password, clientType: 'native', platform: 'android', deviceName: 'n1' },
      { ip: '127.0.0.1' },
    );
    const headers = { authorization: `Bearer ${accessToken(app, session.user, session.session)}` };
    const conversation = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/direct',
      headers,
      payload: { userId: peer.id },
    });
    assertStatus(conversation, 201);
    const text = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversation.json().id}/messages`,
      headers,
      payload: { clientMessageId: randomUUID(), content: 'plain text without storage' },
    });
    assertStatus(text, 201);
    assert.equal(text.json().content, 'plain text without storage');
    const init = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversation.json().id}/attachments`,
      headers,
      payload: { fileName: 'pixel.png', mimeType: 'image/png', sizeBytes: PNG.length },
    });
    assertStatus(init, 503);
    assert.equal(init.json().error.code, 'STORAGE_UNAVAILABLE');
  },
);
