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

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');

const waitEvent = (socket, event, predicate = () => true) =>
  new Promise((resolve, reject) => {
    const match = (message) => message.event === event && predicate(message);
    const existing = socket.chatEvents.find(match);
    if (existing) return resolve(existing);
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`Timed out waiting for ${event} on ${socket.label}`));
    }, 5000);
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (!match(message)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
    const raced = socket.chatEvents.find(match);
    if (raced) {
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(raced);
    }
  });

const open = async (url, token, label) => {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  socket.label = label;
  socket.chatEvents = [];
  socket.chatClose = null;
  socket.on('message', (raw) => socket.chatEvents.push(JSON.parse(raw.toString())));
  socket.on('close', (code, reason) => {
    socket.chatClose = { code, reason: reason.toString() };
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await waitEvent(socket, 'connection.ready');
  return socket;
};

const rejectedSocket = (url, token) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url, token ? { headers: { authorization: `Bearer ${token}` } } : {});
    const timer = setTimeout(() => reject(new Error('Unauthorized socket remained open')), 3000);
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    socket.once('error', () => {});
  });

test('Phase 3 Batch 3: reconnection, change-sync and session recovery', { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' }, async (t) => {
  const config = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testUrl,
    JWT_SECRET: 'batch-three-secret-'.repeat(4),
  });
  const app = await buildApp({ config });
  t.after(() => app.close());
  await app.database.db.execute(
    sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
  );
  const password = 'Batch-Three-Password-9!';
  const hash = await hashPassword(password);
  const [a, b, c, d] = await app.database.db
    .insert(users)
    .values(['sync-a', 'sync-b', 'sync-c', 'sync-d'].map((username) => ({
      username,
      displayName: username,
      passwordHash: hash,
      mustChangePassword: false,
    })))
    .returning();
  const auth = authService(app, config);
  const login = (user, device) =>
    auth.login(
      { username: user.username, password, clientType: 'native', platform: 'android', deviceName: device },
      { ip: '127.0.0.1' },
    );
  const [sessionA, sessionB1, sessionB2, sessionC, sessionD] = await Promise.all([
    login(a, 'a'),
    login(b, 'b1'),
    login(b, 'b2'),
    login(c, 'c'),
    login(d, 'd'),
  ]);
  const token = (result) => accessToken(app, result.user, result.session);
  const header = (result) => ({ authorization: `Bearer ${token(result)}` });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const wsUrl = address.replace('http:', 'ws:') + '/api/v1/ws';
  assert.equal(await rejectedSocket(wsUrl), 4001);
  const expired = app.jwt.sign({ sub: a.id, sid: sessionA.session.id }, { expiresIn: -1 });
  assert.equal(await rejectedSocket(wsUrl, expired), 4001);
  const [aSocket, bSocket1, bSocket2, cSocket] = await Promise.all([
    open(wsUrl, token(sessionA), 'A'),
    open(wsUrl, token(sessionB1), 'B1'),
    open(wsUrl, token(sessionB2), 'B2'),
    open(wsUrl, token(sessionC), 'C'),
  ]);
  t.after(() => [aSocket, bSocket1, bSocket2, cSocket].forEach((socket) => socket.terminate()));

  const direct = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/direct',
      headers: header(sessionA),
      payload: { userId: b.id },
    })
  ).json();
  const group = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: header(sessionA),
      payload: { title: 'Sync group' },
    })
  ).json();
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${group.id}/members`,
      headers: header(sessionA),
      payload: { userId: b.id },
    })).statusCode,
    201,
  );

  const send = (conversationId, session, content, extra = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: header(session),
      payload: { clientMessageId: extra.clientMessageId ?? randomUUID(), content, ...extra },
    });
  const first = (await send(direct.id, sessionA, 'keep')).json();
  await waitEvent(bSocket1, 'message.created', (event) => event.data.id === first.id);
  const editable = (await send(direct.id, sessionB1, 'will edit')).json();
  const deletable = (await send(direct.id, sessionB1, 'will delete')).json();
  await waitEvent(aSocket, 'message.created', (event) => event.data.id === deletable.id);
  await waitEvent(bSocket2, 'message.created', (event) => event.data.id === deletable.id);
  const cursor = (
    await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${direct.id}/sync?afterChangeSeq=0&limit=50`,
      headers: header(sessionA),
    })
  ).json();
  assert.equal(cursor.data.length, 3);
  assert.ok(cursor.data.every((row, index) => index === 0 || row.changeSeq > cursor.data[index - 1].changeSeq));
  const savedMessageSeq = cursor.lastMessageSeq;
  const savedChangeSeq = cursor.lastChangeSeq;
  assert.equal(savedMessageSeq, deletable.sequenceNumber);
  assert.ok(savedChangeSeq >= savedMessageSeq);

  aSocket.terminate();
  await new Promise((resolve) => {
    if (aSocket.chatClose) return resolve();
    aSocket.once('close', resolve);
  });
  const untilGone = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (app.connections.user(a.id).size === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('A remained in the connection registry after disconnect');
  };
  await untilGone();

  const edited = await app.inject({
    method: 'PATCH',
    url: `/api/v1/messages/${editable.id}`,
    headers: header(sessionB1),
    payload: { content: 'edited while A offline' },
  });
  assert.equal(edited.statusCode, 200);
  assert.ok(edited.json().changeSeq > savedChangeSeq);
  assert.equal(edited.json().sequenceNumber, editable.sequenceNumber);
  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/v1/messages/${deletable.id}`,
    headers: header(sessionB1),
  });
  assert.equal(removed.statusCode, 200);
  const missed = await send(direct.id, sessionB1, 'sent while A offline');
  assert.equal(missed.statusCode, 201);
  assert.ok(missed.json().sequenceNumber > savedMessageSeq);
  await waitEvent(bSocket2, 'message.created', (event) => event.data.id === missed.json().id);
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${first.id}/delivered`,
      headers: header(sessionB1),
    })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${direct.id}/read`,
      headers: header(sessionB1),
      payload: { sequenceNumber: missed.json().sequenceNumber },
    })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${group.id}/members`,
      headers: header(sessionA),
      payload: { userId: d.id },
    })).statusCode,
    201,
  );

  const history = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${direct.id}/messages?afterSeq=${savedMessageSeq}&limit=50`,
    headers: header(sessionA),
  });
  assert.equal(history.statusCode, 200);
  assert.deepEqual(
    history.json().data.map((row) => row.id),
    [missed.json().id],
  );
  assert.ok(!history.json().data.some((row) => row.id === editable.id || row.id === deletable.id));

  const sync = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${direct.id}/sync?afterChangeSeq=${savedChangeSeq}&limit=50`,
    headers: header(sessionA),
  });
  assert.equal(sync.statusCode, 200);
  const synced = sync.json();
  const syncedIds = synced.data.map((row) => row.id);
  assert.ok(syncedIds.includes(editable.id));
  assert.ok(syncedIds.includes(deletable.id));
  assert.ok(syncedIds.includes(missed.json().id));
  assert.ok(!syncedIds.includes(first.id));
  assert.equal(new Set(syncedIds).size, syncedIds.length);
  assert.ok(synced.data.every((row, index) => index === 0 || row.changeSeq > synced.data[index - 1].changeSeq));
  const editedSync = synced.data.find((row) => row.id === editable.id);
  assert.equal(editedSync.content, 'edited while A offline');
  assert.ok(editedSync.editedAt);
  const deletedSync = synced.data.find((row) => row.id === deletable.id);
  assert.equal(deletedSync.content, '');
  assert.ok(deletedSync.deletedAt);
  assert.equal(synced.lastMessageSeq, missed.json().sequenceNumber);
  assert.ok(synced.lastChangeSeq > savedChangeSeq);

  const deviceSync = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${direct.id}/sync?afterChangeSeq=${savedChangeSeq}&limit=50`,
    headers: header(sessionB2),
  });
  assert.deepEqual(
    deviceSync.json().data.map((row) => row.id),
    synced.data.map((row) => row.id),
  );

  const details = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${direct.id}`,
    headers: header(sessionA),
  });
  assert.equal(details.statusCode, 200);
  const bMember = details.json().members.find((member) => member.id === b.id);
  assert.equal(bMember.lastReadSeq, missed.json().sequenceNumber);
  const receipts = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${direct.id}/receipts`,
    headers: header(sessionA),
  });
  assert.equal(receipts.statusCode, 200);
  assert.ok(
    receipts.json().some((row) => row.messageId === first.id && row.userId === b.id && row.deliveredAt),
  );
  assert.ok(receipts.json().some((row) => row.userId === b.id && row.readAt));
  assert.equal(
    (await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${direct.id}/receipts`,
      headers: header(sessionC),
    })).statusCode,
    404,
  );

  const pendingId = randomUUID();
  const pending = await send(direct.id, sessionA, 'queued offline', { clientMessageId: pendingId });
  assert.equal(pending.statusCode, 201);
  const replay = await send(direct.id, sessionA, 'queued offline', { clientMessageId: pendingId });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, pending.json().id);

  const reopened = await open(wsUrl, token(sessionA), 'A-reopen');
  t.after(() => reopened.terminate());
  const live = waitEvent(reopened, 'message.created', (event) => event.data.content === 'after reconnect');
  const liveB = waitEvent(bSocket1, 'message.created', (event) => event.data.content === 'after reconnect');
  const after = await send(direct.id, sessionB1, 'after reconnect');
  assert.equal(after.statusCode, 201);
  assert.equal((await live).data.id, after.json().id);
  assert.equal((await liveB).data.id, after.json().id);
  assert.equal(cSocket.chatEvents.filter((event) => event.event === 'message.created').length, 0);

  const dSession = sessionD;
  const dHistory = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${group.id}/messages?afterSeq=0&limit=50`,
    headers: header(dSession),
  });
  assert.equal(dHistory.statusCode, 200);
  assert.ok(dHistory.json().data.some((row) => row.messageType === 'system'));
  const dSync = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${group.id}/sync?afterChangeSeq=0&limit=50`,
    headers: header(dSession),
  });
  assert.equal(dSync.statusCode, 200);
  assert.ok(dSync.json().lastChangeSeq > 0);

  assert.equal(
    (await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${group.id}/members/${b.id}`,
      headers: header(sessionA),
    })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${group.id}/sync?afterChangeSeq=0`,
      headers: header(sessionB1),
    })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${group.id}`,
      headers: header(sessionB1),
    })).statusCode,
    403,
  );

  await app.database.db.execute(sql`update sessions set revoked_at = now() where id = ${sessionC.session.id}::uuid`);
  assert.equal(await rejectedSocket(wsUrl, token(sessionC)), 4001);
  assert.equal(reopened.readyState, WebSocket.OPEN);
  assert.equal(bSocket1.readyState, WebSocket.OPEN);
  assert.equal(bSocket2.readyState, WebSocket.OPEN);
});
