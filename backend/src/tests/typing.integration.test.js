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
const secret = 'typing-direction-secret-'.repeat(4);

const waitFor = (socket, event, predicate = () => true, timeoutMs = 3000) =>
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

test(
  'typing events use the authenticated typer and are not echoed to that account',
  { skip: !enabled },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: testUrl,
      JWT_SECRET: secret,
      COOKIE_SECRET: `${secret}cookie`,
      CSRF_SECRET: `${secret}csrf`,
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.ready();
    const hash = await hashPassword('Password!234');
    const [alphaUser, bravoUser] = await app.database.db
      .insert(users)
      .values([
        { username: `typ-a-${randomUUID().slice(0, 8)}`, displayName: 'Alpha', passwordHash: hash, mustChangePassword: false },
        { username: `typ-b-${randomUUID().slice(0, 8)}`, displayName: 'Bravo', passwordHash: hash, mustChangePassword: false },
      ])
      .returning();
    const auth = authService(app, config);
    const sessionA = await auth.createSession(alphaUser, { clientType: 'web' });
    const sessionB = await auth.createSession(bravoUser, { clientType: 'web' });
    const sessionB2 = await auth.createSession(bravoUser, { clientType: 'web' });
    const header = (session) => ({ authorization: `Bearer ${accessToken(config, session)}` });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/direct',
      headers: header(sessionA),
      payload: { userId: bravoUser.id },
    });
    const conversationId = created.json().id;
    const wsAddress = `ws://127.0.0.1:${app.server.address().port}/api/v1/ws`;
    const alphaSocket = await openSocket(wsAddress, accessToken(config, sessionA));
    const bravoSocket = await openSocket(wsAddress, accessToken(config, sessionB));
    const bravoSecond = await openSocket(wsAddress, accessToken(config, sessionB2));
    t.after(() => {
      alphaSocket.terminate();
      bravoSocket.terminate();
      bravoSecond.terminate();
    });

    const seenByAlpha = waitFor(
      alphaSocket,
      'typing.updated',
      (event) => event.data.userId === bravoUser.id && event.data.typing === true,
    );
    bravoSocket.send(JSON.stringify({ event: 'typing.start', data: { conversationId } }));
    const typing = await seenByAlpha;
    assert.equal(typing.data.userId, bravoUser.id);
    assert.equal(typing.data.conversationId, conversationId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      bravoSocket.chatEvents.some((event) => event.event === 'typing.updated' && event.data.userId === bravoUser.id),
      false,
    );
    assert.equal(
      bravoSecond.chatEvents.some((event) => event.event === 'typing.updated' && event.data.userId === bravoUser.id),
      false,
    );

    const seenByBravo = waitFor(
      bravoSocket,
      'typing.updated',
      (event) => event.data.userId === alphaUser.id && event.data.typing === true,
    );
    alphaSocket.send(JSON.stringify({ event: 'typing.start', data: { conversationId } }));
    const reverse = await seenByBravo;
    assert.equal(reverse.data.userId, alphaUser.id);

    const forbidden = waitFor(bravoSocket, 'error');
    bravoSocket.send(JSON.stringify({ event: 'typing.start', data: { conversationId: randomUUID() } }));
    assert.equal((await forbidden).data.code, 'FORBIDDEN_EVENT');

    await app.database.db.execute(sql`select 1`);
  },
);
