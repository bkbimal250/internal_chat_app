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
const secret = 'typing-direction-secret-value-'.repeat(3);
const password = 'Typing-Password-9!';

const waitFor = (socket, event, predicate = () => true, timeoutMs = 4000) =>
  new Promise((resolve, reject) => {
    const queued = socket.chatEvents.findIndex((message) => message.event === event && predicate(message));
    if (queued >= 0) return resolve(socket.chatEvents.splice(queued, 1)[0]);
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}; received ${JSON.stringify(socket.chatEvents)}`)),
      timeoutMs,
    );
    const receive = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.event !== event || !predicate(message)) return;
      clearTimeout(timeout);
      socket.off('message', receive);
      resolve(message);
    };
    socket.on('message', receive);
  });

const openSocket = async (url, token) => {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  socket.chatEvents = [];
  socket.on('message', (raw) => socket.chatEvents.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await waitFor(socket, 'connection.ready');
  return socket;
};

async function startTypingApp(t) {
  const config = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testUrl,
    JWT_SECRET: secret,
  });
  const app = await buildApp({ config });
  t.after(() => app.close());
  await app.database.db.execute(
    sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, conversation_members, conversations, messages, users restart identity cascade`,
  );
  const hash = await hashPassword(password);
  const [alphaUser, bravoUser, charlieUser] = await app.database.db
    .insert(users)
    .values([
      { username: `typ-a-${randomUUID().slice(0, 8)}`, displayName: 'Alpha', passwordHash: hash, mustChangePassword: false },
      { username: `typ-b-${randomUUID().slice(0, 8)}`, displayName: 'Bravo', passwordHash: hash, mustChangePassword: false },
      { username: `typ-c-${randomUUID().slice(0, 8)}`, displayName: 'Charlie', passwordHash: hash, mustChangePassword: false },
    ])
    .returning();
  const auth = authService(app, config);
  const login = (user, device) =>
    auth.login(
      { username: user.username, password, clientType: 'web', platform: 'web', deviceName: device },
      { ip: '127.0.0.1' },
    );
  const sessionA = await login(alphaUser, 'a1');
  const sessionB = await login(bravoUser, 'b1');
  const sessionB2 = await login(bravoUser, 'b2');
  const sessionC = await login(charlieUser, 'c1');
  const token = (result) => accessToken(app, result.user, result.session);
  const header = (result) => ({ authorization: `Bearer ${token(result)}` });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const wsUrl = address.replace('http', 'ws') + '/api/v1/ws';
  return {
    app,
    alphaUser,
    bravoUser,
    charlieUser,
    sessionA,
    sessionB,
    sessionB2,
    sessionC,
    token,
    header,
    wsUrl,
  };
}

test(
  'typing events use the authenticated typer and are not echoed to that account',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const ctx = await startTypingApp(t);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/conversations/direct',
      headers: ctx.header(ctx.sessionA),
      payload: { userId: ctx.bravoUser.id },
    });
    assert.equal(created.statusCode, 201);
    const conversationId = created.json().id;
    const alphaSocket = await openSocket(ctx.wsUrl, ctx.token(ctx.sessionA));
    const bravoSocket = await openSocket(ctx.wsUrl, ctx.token(ctx.sessionB));
    const bravoSecond = await openSocket(ctx.wsUrl, ctx.token(ctx.sessionB2));
    t.after(() => {
      alphaSocket.terminate();
      bravoSocket.terminate();
      bravoSecond.terminate();
    });

    const seenByAlpha = waitFor(
      alphaSocket,
      'typing.updated',
      (event) => event.data.userId === ctx.bravoUser.id && event.data.typing === true,
    );
    bravoSocket.send(JSON.stringify({ event: 'typing.start', data: { conversationId } }));
    const typing = await seenByAlpha;
    assert.equal(typing.data.userId, ctx.bravoUser.id);
    assert.equal(typing.data.conversationId, conversationId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      bravoSocket.chatEvents.some((event) => event.event === 'typing.updated' && event.data.userId === ctx.bravoUser.id),
      false,
    );
    assert.equal(
      bravoSecond.chatEvents.some((event) => event.event === 'typing.updated' && event.data.userId === ctx.bravoUser.id),
      false,
    );

    const seenByBravo = waitFor(
      bravoSocket,
      'typing.updated',
      (event) => event.data.userId === ctx.alphaUser.id && event.data.typing === true,
    );
    alphaSocket.send(JSON.stringify({ event: 'typing.start', data: { conversationId } }));
    const reverse = await seenByBravo;
    assert.equal(reverse.data.userId, ctx.alphaUser.id);

    const forbidden = waitFor(bravoSocket, 'error');
    bravoSocket.send(JSON.stringify({ event: 'typing.start', data: { conversationId: randomUUID() } }));
    assert.equal((await forbidden).data.code, 'FORBIDDEN_EVENT');
  },
);

test(
  'group typing fans out to other members in both directions',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const ctx = await startTypingApp(t);
    const group = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: ctx.header(ctx.sessionA),
      payload: { title: 'Typing group' },
    });
    assert.equal(group.statusCode, 201);
    const conversationId = group.json().id;
    const inviteB = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/groups/${conversationId}/members`,
      headers: ctx.header(ctx.sessionA),
      payload: { userId: ctx.bravoUser.id },
    });
    assert.ok([200, 201].includes(inviteB.statusCode));
    const inviteC = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/groups/${conversationId}/members`,
      headers: ctx.header(ctx.sessionA),
      payload: { userId: ctx.charlieUser.id },
    });
    assert.ok([200, 201].includes(inviteC.statusCode));

    const alphaSocket = await openSocket(ctx.wsUrl, ctx.token(ctx.sessionA));
    const bravoSocket = await openSocket(ctx.wsUrl, ctx.token(ctx.sessionB));
    const charlieSocket = await openSocket(ctx.wsUrl, ctx.token(ctx.sessionC));
    t.after(() => {
      alphaSocket.terminate();
      bravoSocket.terminate();
      charlieSocket.terminate();
    });

    const bravoSawAlpha = waitFor(
      bravoSocket,
      'typing.updated',
      (event) => event.data.userId === ctx.alphaUser.id && event.data.conversationId === conversationId,
    );
    const charlieSawAlpha = waitFor(
      charlieSocket,
      'typing.updated',
      (event) => event.data.userId === ctx.alphaUser.id && event.data.conversationId === conversationId,
    );
    alphaSocket.send(JSON.stringify({ event: 'typing.start', data: { conversationId } }));
    assert.equal((await bravoSawAlpha).data.typing, true);
    assert.equal((await charlieSawAlpha).data.userId, ctx.alphaUser.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      alphaSocket.chatEvents.some((event) => event.event === 'typing.updated' && event.data.userId === ctx.alphaUser.id),
      false,
    );

    const alphaSawBravo = waitFor(
      alphaSocket,
      'typing.updated',
      (event) => event.data.userId === ctx.bravoUser.id && event.data.conversationId === conversationId,
    );
    const charlieSawBravo = waitFor(
      charlieSocket,
      'typing.updated',
      (event) => event.data.userId === ctx.bravoUser.id && event.data.conversationId === conversationId,
    );
    bravoSocket.send(JSON.stringify({ event: 'typing.start', data: { conversationId } }));
    assert.equal((await alphaSawBravo).data.userId, ctx.bravoUser.id);
    assert.equal((await charlieSawBravo).data.typing, true);
  },
);
