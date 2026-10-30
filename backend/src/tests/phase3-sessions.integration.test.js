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
import { sessionsService } from '../modules/sessions/sessions.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');
const password = 'Batch-One-Password-9!';
const wait = (socket, event) => new Promise((resolve, reject) => {
  const queued = socket.chatEvents.findIndex((message) => message.event === event);
  if (queued >= 0) return resolve(socket.chatEvents.splice(queued, 1)[0]);
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 15000);
  const listener = (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.event !== event) return;
    clearTimeout(timer);
    socket.off('message', listener);
    const index = socket.chatEvents.findIndex((queuedMessage) => queuedMessage.event === event);
    resolve(index >= 0 ? socket.chatEvents.splice(index, 1)[0] : message);
  };
  socket.on('message', listener);
});
const open = async (url, token, options = {}) => {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` }, ...options });
  socket.chatEvents = [];
  socket.on('message', (raw) => socket.chatEvents.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  await wait(socket, 'connection.ready');
  return socket;
};
const eventually = async (predicate) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Condition did not become true');
};

test('Phase 3 Batch 1: fifty sessions and suspension', { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' }, async (t) => {
  const config = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: testUrl, JWT_SECRET: 'batch-one-secret-'.repeat(5), WS_HEARTBEAT_INTERVAL_MS: '1000' });
  const app = await buildApp({ config });
  t.after(() => app.close());
  await app.database.db.execute(sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`);
  const hash = await hashPassword(password);
  const [sender, recipient, observer] = await app.database.db.insert(users).values([
    { username: 'batch-sender', displayName: 'Sender', passwordHash: hash, mustChangePassword: false },
    { username: 'batch-recipient', displayName: 'Recipient', passwordHash: hash, mustChangePassword: false },
    { username: 'batch-observer', displayName: 'Observer', passwordHash: hash, mustChangePassword: false },
  ]).returning();
  const auth = authService(app, config);
  const login = (user, deviceName) => auth.login({ username: user.username, password, clientType: 'native', platform: 'android', deviceName }, { ip: '127.0.0.1' });
  const senderSession = await login(sender, 'sender');
  const sessions = await Promise.all(Array.from({ length: 50 }, (_, index) => login(recipient, `recipient-${index}`)));
  await assert.rejects(() => login(recipient, 'recipient-51'), { code: 'SESSION_LIMIT' });
  const senderToken = accessToken(app, senderSession.user, senderSession.session);
  const recipientTokens = sessions.map((item) => accessToken(app, item.user, item.session));
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const wsUrl = address.replace('http:', 'ws:') + '/api/v1/ws';
  const sockets = await Promise.all(recipientTokens.map((token) => open(wsUrl, token)));
  t.after(() => sockets.forEach((socket) => socket.terminate()));
  assert.equal(app.connections.user(recipient.id).size, 50);
  const direct = (await app.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers: { authorization: `Bearer ${senderToken}` }, payload: { userId: recipient.id } })).json();
  const received = sockets.map((socket) => wait(socket, 'message.created'));
  const sent = await app.inject({ method: 'POST', url: `/api/v1/conversations/${direct.id}/messages`, headers: { authorization: `Bearer ${senderToken}` }, payload: { clientMessageId: randomUUID(), content: 'all devices' } });
  assert.equal(sent.statusCode, 201);
  const events = await Promise.all(received);
  assert.ok(events.every((event) => event.data.id === sent.json().id));
  const revokedClose = new Promise((resolve) => sockets[0].once('close', (code) => resolve(code)));
  await sessionsService(app).revoke(recipient.id, sessions[0].session.id, { userId: recipient.id, sessionId: sessions[0].session.id });
  assert.equal(await revokedClose, 4001);
  await eventually(() => app.connections.user(recipient.id).size === 49);
  assert.equal(app.connections.user(recipient.id).size, 49);
  assert.ok(sockets.slice(1).every((socket) => socket.readyState === WebSocket.OPEN));
  await auth.logout({ userId: recipient.id, sessionId: sessions[1].session.id }, true);
  await eventually(() => app.connections.user(recipient.id).size === 0);
  assert.equal(app.connections.user(recipient.id).size, 0);
  const suspended = await login(observer, 'observer');
  await app.database.db.execute(sql`update users set status = 'suspended' where id = ${observer.id}::uuid`);
  const suspendedToken = accessToken(app, suspended.user, suspended.session);
  const rejected = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${suspendedToken}` } });
  assert.equal(await new Promise((resolve) => rejected.once('close', resolve)), 4001);
});
