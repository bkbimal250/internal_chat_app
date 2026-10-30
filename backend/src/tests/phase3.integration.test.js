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
const secret = 'phase-three-integration-secret-'.repeat(4);

const waitFor = (socket, event, predicate = () => true) =>
  new Promise((resolve, reject) => {
    const queued = socket.chatEvents.findIndex((message) => message.event === event && predicate(message));
    if (queued >= 0) return resolve(socket.chatEvents.splice(queued, 1)[0]);
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}; received ${JSON.stringify(socket.chatEvents)}`)), 3000);
    const check = (message) => {
      if (message.event !== event || !predicate(message)) return;
      clearTimeout(timeout);
      socket.off('message', receive);
      const index = socket.chatEvents.findIndex((queuedMessage) => queuedMessage.event === event && predicate(queuedMessage));
      resolve(index >= 0 ? socket.chatEvents.splice(index, 1)[0] : message);
    };
    const receive = (raw) => check(JSON.parse(raw.toString()));
    socket.on('message', receive);
  });

const openSocket = async (url, token) => {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
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
  await waitFor(socket, 'connection.ready');
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

test('Phase 3 PostgreSQL and real WebSocket integration', { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' }, async (t) => {
  const config = loadEnv({
    NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: testUrl, JWT_SECRET: secret,
    CORS_ORIGINS: 'https://web.test', GROUP_MEMBER_LIMIT: '2', WS_HEARTBEAT_INTERVAL_MS: '10000',
  });
  const app = await buildApp({ config });
  t.after(async () => app.close());
  await app.database.db.execute(sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`);
  const passwordHash = await hashPassword('Phase-Three-Password-9!');
  const employees = await app.database.db.insert(users).values([
    { username: 'alpha', displayName: 'Alpha', passwordHash, mustChangePassword: false },
    { username: 'bravo', displayName: 'Bravo', passwordHash, mustChangePassword: false },
    { username: 'charlie', displayName: 'Charlie', passwordHash, mustChangePassword: false },
  ]).returning();
  const login = (user) => authService(app, config).login({ username: user.username, password: 'Phase-Three-Password-9!', clientType: 'native', platform: 'android', deviceName: `${user.username} device` }, { ip: '127.0.0.1' });
  const [alpha, bravo, charlie] = await Promise.all(employees.map(login));
  const token = (result) => accessToken(app, result.user, result.session);
  const alphaToken = token(alpha);
  const bravoToken = token(bravo);
  const alphaHeaders = { authorization: `Bearer ${alphaToken}` };
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const wsAddress = address.replace('http:', 'ws:') + '/api/v1/ws';
  assert.equal(await rejectedSocket(wsAddress), 4001);
  assert.equal(await rejectedSocket(wsAddress, 'not-a-jwt'), 4001);
  const expired = app.jwt.sign({ sub: charlie.user.id, sid: charlie.session.id }, { expiresIn: -1 });
  assert.equal(await rejectedSocket(wsAddress, expired), 4001);
  await app.database.db.execute(sql`update sessions set revoked_at = now() where id = ${charlie.session.id}::uuid`);
  assert.equal(await rejectedSocket(wsAddress, token(charlie)), 4001);
  const alphaSocket = await openSocket(wsAddress, alphaToken);
  const bravoSocket = await openSocket(wsAddress, bravoToken);
  assert.equal(app.connections.user(bravo.user.id).size, 1);
  t.after(() => {
    alphaSocket.terminate();
    bravoSocket.terminate();
  });

  const directResponse = await app.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers: alphaHeaders, payload: { userId: bravo.user.id } });
  assert.equal(directResponse.statusCode, 201);
  const direct = directResponse.json();
  assert.equal(
    [...app.connections.user(bravo.user.id)][0].socket.readyState,
    WebSocket.OPEN,
    JSON.stringify(bravoSocket.chatClose),
  );
  const bravoSecondSocket = await openSocket(wsAddress, bravoToken);
  t.after(() => bravoSecondSocket.terminate());
  const messageCreated = waitFor(bravoSocket, 'message.created');
  const messageCreatedSecond = waitFor(bravoSecondSocket, 'message.created');
  const created = await app.inject({
    method: 'POST', url: `/api/v1/conversations/${direct.id}/messages`, headers: alphaHeaders,
    payload: { clientMessageId: randomUUID(), content: 'Hello from Alpha' },
  });
  assert.equal(created.statusCode, 201);
  const message = created.json();
  const received = await messageCreated;
  assert.equal((await messageCreatedSecond).data.id, message.id);
  assert.equal(received.data.id, message.id);
  assert.equal(received.data.content, 'Hello from Alpha');
  const typingEvent = waitFor(alphaSocket, 'typing.updated', (event) => event.data.userId === bravo.user.id);
  bravoSocket.send(JSON.stringify({ event: 'typing.start', data: { conversationId: direct.id } }));
  const typing = await typingEvent;
  assert.equal(typing.data.typing, true);
  const pong = waitFor(bravoSocket, 'pong');
  bravoSocket.send(JSON.stringify({ event: 'ping' }));
  await pong;
  const invalidEvent = waitFor(bravoSocket, 'error');
  bravoSocket.send('{invalid json');
  assert.equal((await invalidEvent).data.code, 'INVALID_EVENT');
  const invalidPayload = waitFor(bravoSocket, 'error');
  bravoSocket.send(JSON.stringify({ event: 'typing.start', data: { conversationId: 'not-a-uuid' } }));
  assert.equal((await invalidPayload).data.code, 'INVALID_EVENT');
  const deliveryEvent = waitFor(alphaSocket, 'receipt.updated', (event) => event.data.messageId === message.id);
  bravoSocket.send(JSON.stringify({ event: 'message.delivered', data: { messageId: message.id } }));
  const delivery = await deliveryEvent;
  assert.equal(delivery.data.delivered, true);
  const read = await app.inject({ method: 'POST', url: `/api/v1/conversations/${direct.id}/read`, headers: { authorization: `Bearer ${bravoToken}` }, payload: { sequenceNumber: message.sequenceNumber } });
  assert.equal(read.statusCode, 200);
  const history = await app.inject({ method: 'GET', url: `/api/v1/conversations/${direct.id}/messages?afterSeq=0`, headers: { authorization: `Bearer ${bravoToken}` } });
  assert.equal(history.json().data.length, 1);

  const groupResponse = await app.inject({ method: 'POST', url: '/api/v1/groups', headers: alphaHeaders, payload: { title: 'Delivery team' } });
  assert.equal(groupResponse.statusCode, 201);
  const group = groupResponse.json();
  const additions = await Promise.all([
    app.inject({ method: 'POST', url: `/api/v1/groups/${group.id}/members`, headers: alphaHeaders, payload: { userId: bravo.user.id } }),
    app.inject({ method: 'POST', url: `/api/v1/groups/${group.id}/members`, headers: alphaHeaders, payload: { userId: charlie.user.id } }),
  ]);
  assert.deepEqual(additions.map((reply) => reply.statusCode).sort(), [201, 409]);
  const members = await app.inject({ method: 'GET', url: `/api/v1/groups/${group.id}/members`, headers: alphaHeaders });
  assert.equal(members.statusCode, 200);
  assert.equal(members.json().length, 2);
  const groupHistory = await app.inject({ method: 'GET', url: `/api/v1/conversations/${group.id}/messages?afterSeq=0`, headers: alphaHeaders });
  assert.equal(groupHistory.statusCode, 200);
  assert.ok(groupHistory.json().data.every((item) => item.messageType === 'system'));

  const closed = new Promise((resolve) => bravoSocket.once('close', (code) => resolve(code)));
  const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { authorization: `Bearer ${bravoToken}` } });
  assert.equal(logout.statusCode, 200);
  assert.equal(await closed, 4001);
});
