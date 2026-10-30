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
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate) => {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await pause(10);
  }
  assert.fail('Timed out waiting for condition');
};
const open = async (url, token, options = {}) => {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` }, ...options });
  socket.events = [];
  socket.on('message', (raw) => socket.events.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  await until(() => socket.events.some((event) => event.event === 'connection.ready'));
  return socket;
};

test('Phase 3 Batch 1: presence lifecycle and heartbeat timeout', { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' }, async (t) => {
  const config = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: testUrl, JWT_SECRET: 'presence-test-secret-'.repeat(5), WS_HEARTBEAT_INTERVAL_MS: '50' });
  const app = await buildApp({ config });
  t.after(() => app.close());
  await app.database.db.execute(sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`);
  const hash = await hashPassword('Presence-Password-9!');
  const [a, b, c] = await app.database.db.insert(users).values([
    { username: 'presence-a', displayName: 'A', passwordHash: hash, mustChangePassword: false },
    { username: 'presence-b', displayName: 'B', passwordHash: hash, mustChangePassword: false },
    { username: 'presence-c', displayName: 'C', passwordHash: hash, mustChangePassword: false },
  ]).returning();
  const auth = authService(app, config);
  const login = (user, device) => auth.login({ username: user.username, password: 'Presence-Password-9!', clientType: 'native', platform: 'android', deviceName: device }, { ip: '127.0.0.1' });
  const [a1, a2, b1, c1] = await Promise.all([login(a, 'a1'), login(a, 'a2'), login(b, 'b1'), login(c, 'c1')]);
  const token = (result) => accessToken(app, result.user, result.session);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const url = address.replace('http:', 'ws:') + '/api/v1/ws';
  const direct = (await app.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers: { authorization: `Bearer ${token(a1)}` }, payload: { userId: b.id } })).json();
  const bSocket = await open(url, token(b1));
  const cSocket = await open(url, token(c1));
  const aSocket = await open(url, token(a1));
  t.after(() => [aSocket, bSocket, cSocket].forEach((socket) => socket.terminate()));
  await until(() => bSocket.events.some((event) => event.event === 'presence.updated' && event.data.userId === a.id && event.data.online));
  assert.equal(cSocket.events.filter((event) => event.event === 'presence.updated').length, 0);
  const onlineCount = bSocket.events.filter((event) => event.event === 'presence.updated' && event.data.userId === a.id && event.data.online).length;
  const aSecond = await open(url, token(a2));
  t.after(() => aSecond.terminate());
  await pause(100);
  assert.equal(bSocket.events.filter((event) => event.event === 'presence.updated' && event.data.userId === a.id && event.data.online).length, onlineCount);
  aSocket.terminate();
  await until(() => app.connections.user(a.id).size === 1);
  assert.equal(bSocket.events.filter((event) => event.event === 'presence.updated' && event.data.userId === a.id && !event.data.online).length, 0);
  aSecond.terminate();
  await until(() => bSocket.events.some((event) => event.event === 'presence.updated' && event.data.userId === a.id && !event.data.online));
  const stale = await open(url, token(await login(a, 'stale')), { autoPong: false });
  t.after(() => stale.terminate());
  await until(() => stale.readyState === WebSocket.CLOSED);
  await until(() => app.connections.user(a.id).size === 0);
  assert.ok(bSocket.readyState === WebSocket.OPEN);
  assert.ok(direct.id);
});
