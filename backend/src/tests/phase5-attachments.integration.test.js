import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import WebSocket from 'ws';
import { sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { users } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';
import { cleanupAttachments } from '../jobs/attachment-cleanup.job.js';
import { attachments } from '../database/schema/index.js';
import { eq } from 'drizzle-orm';

const testUrl = process.env.TEST_DATABASE_URL;
const s3Endpoint = process.env.S3_ENDPOINT;
const enabled =
  testUrl && new URL(testUrl).pathname.endsWith('_test') && Boolean(s3Endpoint && process.env.S3_ACCESS_KEY);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

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
      S3_BUCKET: process.env.S3_TEST_BUCKET || 'company-chat-test',
      S3_REGION: process.env.S3_REGION || 'us-east-1',
      ATTACHMENT_PENDING_TTL_MS: '60000',
    });
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
    assert.equal(conversation.statusCode, 201);
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

    const init = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: { fileName: 'pixel.png', mimeType: 'image/png', sizeBytes: PNG.length },
    });
    assert.equal(init.statusCode, 201, init.body);
    assert.ok(init.json().uploadUrl);
    assert.ok(!JSON.stringify(init.json()).includes(config.s3SecretKey));
    const pendingUrl = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${init.json().id}/url`,
      headers: header(sessionB),
    });
    assert.equal(pendingUrl.statusCode, 404);

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
    assert.equal(finalized.statusCode, 201, finalized.body);
    assert.equal(finalized.json().messageType, 'image');
    assert.equal(finalized.json().attachment.status, 'available');
    assert.ok(!finalized.json().attachment.storageKey);

    const created = await waitEvent(
      socketB,
      'message.created',
      (event) => event.data.id === finalized.json().id,
    );
    assert.equal(created.data.attachment.mimeType, 'image/png');
    const mirrored = await waitEvent(
      socketA2,
      'message.created',
      (event) => event.data.id === finalized.json().id,
    );
    assert.equal(mirrored.data.attachment.id, finalized.json().attachment.id);

    const download = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${finalized.json().attachment.id}/url`,
      headers: header(sessionB),
    });
    assert.equal(download.statusCode, 200);
    assert.equal(download.json().inline, true);
    const object = await fetch(download.json().url);
    assert.ok(object.ok);
    assert.equal(Buffer.from(await object.arrayBuffer()).equals(PNG), true);
    const saveUrl = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${finalized.json().attachment.id}/url?download=true`,
      headers: header(sessionB),
    });
    assert.equal(saveUrl.statusCode, 200);
    assert.equal(saveUrl.json().inline, false);

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
    assert.equal(multiInit.statusCode, 201, multiInit.body);
    assert.equal(multiInit.json().mode, 'multipart');
    assert.ok(!multiInit.json().uploadUrl);
    const signed = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${multiInit.json().id}/parts`,
      headers: header(sessionA),
      payload: { partNumbers: [1] },
    });
    assert.equal(signed.statusCode, 200, signed.body);
    const partPut = await fetch(signed.json().parts[0].uploadUrl, { method: 'PUT', body: PNG });
    assert.ok(partPut.ok, `part PUT failed ${partPut.status}`);
    const etag = partPut.headers.get('etag');
    assert.ok(etag);
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${multiInit.json().id}/parts`,
      headers: header(sessionA),
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().parts.length, 1);
    const multiFinal = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${multiInit.json().id}/finalize`,
      headers: header(sessionA),
      payload: { clientMessageId: randomUUID(), parts: [{ partNumber: 1, etag }] },
    });
    assert.equal(multiFinal.statusCode, 201, multiFinal.body);
    assert.equal(multiFinal.json().attachment.status, 'available');

    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${finalized.json().attachment.id}/url`,
      headers: header(sessionC),
    });
    assert.equal(denied.statusCode, 404);

    const outsiderInit = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionC),
      payload: { fileName: 'secret.png', mimeType: 'image/png', sizeBytes: PNG.length },
    });
    assert.equal(outsiderInit.statusCode, 404);

    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: { fileName: 'payload.exe', mimeType: 'application/x-msdownload', sizeBytes: 100 },
    });
    assert.equal(invalid.statusCode, 415);

    const oversized = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: { fileName: 'huge.png', mimeType: 'image/png', sizeBytes: 26 * 1024 * 1024 },
    });
    assert.equal(oversized.statusCode, 413);

    const mismatchInit = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers: header(sessionA),
      payload: { fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: PNG.length },
    });
    assert.equal(mismatchInit.statusCode, 201);
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
    assert.equal(mismatch.statusCode, 415);

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
    assert.equal(cancelled.statusCode, 200);
    const cancelledFinalize = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${cancelledInit.json().id}/finalize`,
      headers: header(sessionA),
      payload: { clientMessageId: randomUUID() },
    });
    assert.equal(cancelledFinalize.statusCode, 409);

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

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/attachments/${finalized.json().attachment.id}`,
      headers: header(sessionA),
    });
    assert.equal(removed.statusCode, 200);
    const gone = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${finalized.json().attachment.id}/url`,
      headers: header(sessionB),
    });
    assert.equal(gone.statusCode, 404);
  },
);
