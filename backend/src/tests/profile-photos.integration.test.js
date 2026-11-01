import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { users } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';

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

async function putPhoto(init, body) {
  const response = await fetch(init.uploadUrl, {
    method: 'PUT',
    headers: init.headers,
    body,
  });
  assert.ok(response.ok, `presigned PUT failed ${response.status}`);
}

test(
  'profile photos: upload, thumbnail, remove, unauthorized, and realtime sync',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test and S3_ENDPOINT' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'profile-photo-secret-'.repeat(4),
      CORS_ORIGINS: 'http://127.0.0.1:5173',
      S3_ENDPOINT: s3Endpoint,
      S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT || s3Endpoint,
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
      S3_SECRET_KEY: process.env.S3_SECRET_KEY,
      S3_BUCKET: process.env.S3_TEST_BUCKET || 'company-chat-test',
      S3_REGION: process.env.S3_REGION || 'us-east-1',
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.storage.ensureBucket();
    await app.database.db.execute(
      sql`truncate table attachments, audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );
    const password = 'Photo-Profile-Password-9!';
    const hash = await hashPassword(password);
    const [owner, peer, admin] = await app.database.db
      .insert(users)
      .values([
        { username: 'photo-a', displayName: 'Photo A', passwordHash: hash, mustChangePassword: false },
        { username: 'photo-b', displayName: 'Photo B', passwordHash: hash, mustChangePassword: false },
        {
          username: 'photo-admin',
          displayName: 'Photo Admin',
          passwordHash: hash,
          role: 'admin',
          mustChangePassword: false,
        },
      ])
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
    const sessionAdmin = await login(admin, 'admin1');
    const token = (result) => accessToken(app, result.user, result.session);
    const header = (result) => ({ authorization: `Bearer ${token(result)}` });
    const conversation = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/direct',
      headers: header(sessionA),
      payload: { userId: peer.id },
    });
    assert.equal(conversation.statusCode, 201);

    const gif = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/photo',
      headers: header(sessionA),
      payload: { mimeType: 'image/gif' },
    });
    assert.ok([400, 415].includes(gif.statusCode), gif.body);

    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${owner.id}/photo`,
      headers: header(sessionA),
      payload: { mimeType: 'image/png' },
    });
    assert.equal(denied.statusCode, 403);

    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const wsUrl = address.replace('http', 'ws') + '/api/v1/ws';
    const socketA2 = await open(wsUrl, token(sessionA2));
    const socketB = await open(wsUrl, token(sessionB));
    t.after(() => {
      socketA2.close();
      socketB.close();
    });

    const init = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/photo',
      headers: header(sessionA),
      payload: { mimeType: 'image/png' },
    });
    assert.equal(init.statusCode, 200);
    const initBody = init.json();
    await putPhoto(initBody, PNG);
    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/photo/complete',
      headers: header(sessionA),
      payload: { key: initBody.key, mimeType: 'image/png' },
    });
    assert.equal(complete.statusCode, 200);
    const completed = complete.json();
    assert.equal(completed.hasProfilePhoto, true);
    assert.ok(completed.profilePhotoUrl);
    assert.match(completed.profilePhotoUrl, /^https?:\/\//);

    const updatedA = await waitEvent(socketA2, 'user.updated', (message) => message.data.userId === owner.id);
    const updatedB = await waitEvent(socketB, 'user.updated', (message) => message.data.userId === owner.id);
    assert.equal(updatedA.data.hasProfilePhoto, true);
    assert.equal(updatedB.data.hasProfilePhoto, true);
    assert.ok(updatedA.data.photoVersion);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: header(sessionB),
    });
    const member = listed.json().data[0].members.find((item) => item.id === owner.id);
    assert.equal(member.hasProfilePhoto, true);
    assert.ok(member.photoVersion);
    assert.equal(member.profilePhotoKey, undefined);

    const directory = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: header(sessionB),
    });
    const person = directory.json().data.find((item) => item.id === owner.id);
    assert.equal(person.hasProfilePhoto, true);

    const photoUrl = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${owner.id}/photo-url`,
      headers: header(sessionB),
    });
    assert.equal(photoUrl.statusCode, 200);
    const signed = await fetch(photoUrl.json().url);
    assert.equal(signed.status, 200);
    assert.match(signed.headers.get('content-type') || '', /image\/webp|octet-stream/);

    const adminInit = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${peer.id}/photo`,
      headers: header(sessionAdmin),
      payload: { mimeType: 'image/png' },
    });
    assert.equal(adminInit.statusCode, 200);
    await putPhoto(adminInit.json(), PNG);
    const adminComplete = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${peer.id}/photo/complete`,
      headers: header(sessionAdmin),
      payload: { key: adminInit.json().key, mimeType: 'image/png' },
    });
    assert.equal(adminComplete.statusCode, 200);
    assert.equal(adminComplete.json().hasProfilePhoto, true);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/users/me/photo',
      headers: header(sessionA),
    });
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.json().hasProfilePhoto, false);
    assert.equal(removed.json().profilePhotoUrl, null);
    await waitEvent(socketB, 'user.updated', (message) => message.data.userId === owner.id && message.data.hasProfilePhoto === false);

    const adminRemoved = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${peer.id}/photo`,
      headers: header(sessionAdmin),
    });
    assert.equal(adminRemoved.statusCode, 200);
    assert.equal(adminRemoved.json().hasProfilePhoto, false);
  },
);
