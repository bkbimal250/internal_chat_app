import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import WebSocket from 'ws';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { auditLogs, messages, sessions, users } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');
const password = 'Admin-Delete-Password-9!';

const wait = (socket, event) =>
  new Promise((resolve, reject) => {
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

const openSocket = async (url, token) => {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  socket.chatEvents = [];
  socket.on('message', (raw) => socket.chatEvents.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await wait(socket, 'connection.ready');
  return socket;
};

test(
  'admin deletion is limited to USER accounts, revokes access, and keeps history',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'admin-delete-secret-'.repeat(4),
      WS_HEARTBEAT_INTERVAL_MS: '1000',
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );

    const hash = await hashPassword(password);
    const [adminA, adminB, employee, extra] = await app.database.db
      .insert(users)
      .values([
        { username: 'del.admin.a', displayName: 'Admin A', passwordHash: hash, role: 'admin', mustChangePassword: false },
        { username: 'del.admin.b', displayName: 'Admin B', passwordHash: hash, role: 'admin', mustChangePassword: false },
        { username: 'del.employee', displayName: 'Employee', passwordHash: hash, role: 'user', mustChangePassword: false, phoneE164: '+15551239999', phoneVerifiedAt: new Date() },
        { username: 'del.extra', displayName: 'Extra', passwordHash: hash, role: 'user', mustChangePassword: false },
        { username: 'del.bystander', displayName: 'Bystander', passwordHash: hash, role: 'user', mustChangePassword: false },
      ])
      .returning();

    const auth = authService(app, config);
    const login = (username, deviceName) =>
      auth.login(
        { username, password, clientType: 'native', platform: 'android', deviceName },
        { ip: '127.0.0.1' },
      );
    const [sessionA, sessionB, sessionEmployee, sessionBystander] = await Promise.all([
      login('del.admin.a', 'admin-a'),
      login('del.admin.b', 'admin-b'),
      login('del.employee', 'employee'),
      login('del.bystander', 'bystander'),
    ]);
    const header = (session) => ({
      authorization: `Bearer ${accessToken(app, session.user, session.session)}`,
    });
    const remove = (id, session) =>
      app.inject({ method: 'DELETE', url: `/api/v1/admin/users/${id}`, headers: session ? header(session) : {} });

    const unauthenticated = await remove(employee.id);
    assert.equal(unauthenticated.statusCode, 401);

    const asUser = await remove(extra.id, sessionBystander);
    assert.equal(asUser.statusCode, 403);
    assert.equal(asUser.json().error.code, 'FORBIDDEN');

    const selfDelete = await remove(adminA.id, sessionA);
    assert.equal(selfDelete.statusCode, 403);
    assert.equal(selfDelete.json().error.code, 'CANNOT_DELETE_SELF');

    const otherAdmin = await remove(adminB.id, sessionA);
    assert.equal(otherAdmin.statusCode, 403);
    assert.equal(otherAdmin.json().error.code, 'CANNOT_DELETE_ADMIN');

    const stillAdmin = await app.database.db.select().from(users).where(eq(users.id, adminB.id));
    assert.equal(stillAdmin[0].deletedAt, null);
    assert.equal(stillAdmin[0].status, 'active');

    const direct = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/conversations/direct',
        headers: header(sessionA),
        payload: { userId: employee.id },
      })
    ).json();
    const posted = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${direct.id}/messages`,
      headers: header(sessionEmployee),
      payload: { clientMessageId: randomUUID(), content: 'keep this history' },
    });
    assert.equal(posted.statusCode, 201);

    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const wsUrl = address.replace('http:', 'ws:') + '/api/v1/ws';
    const socket = await openSocket(wsUrl, accessToken(app, sessionEmployee.user, sessionEmployee.session));
    t.after(() => socket.terminate());
    assert.equal(app.connections.user(employee.id).size, 1);
    const closed = new Promise((resolve) => socket.once('close', (code) => resolve(code)));

    const deleted = await remove(employee.id, sessionA);
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().success, true);
    assert.equal(await closed, 4001);
    assert.equal(app.connections.user(employee.id).size, 0);

    const [storedUser] = await app.database.db.select().from(users).where(eq(users.id, employee.id));
    assert.ok(storedUser.deletedAt);
    assert.equal(storedUser.status, 'suspended');
    assert.match(storedUser.username, /^deleted\./);
    assert.equal(storedUser.phoneE164, null);

    const activeSessions = await app.database.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, employee.id), isNull(sessions.revokedAt)));
    assert.equal(activeSessions.length, 0);
    const [revokedSession] = await app.database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionEmployee.session.id));
    assert.ok(revokedSession.revokedAt);
    assert.equal(revokedSession.revocationReason, 'account_deleted');

    const staleMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: header(sessionEmployee),
    });
    assert.equal(staleMe.statusCode, 401);

    const relogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'del.employee',
        password,
        clientType: 'native',
        platform: 'android',
        deviceName: 'after-delete',
      },
    });
    assert.equal(relogin.statusCode, 401);
    assert.equal(relogin.json().error.code, 'INVALID_CREDENTIALS');

    const deletedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: storedUser.username,
        password,
        clientType: 'native',
        platform: 'android',
        deviceName: 'tombstone',
      },
    });
    assert.equal(deletedLogin.statusCode, 401);

    const [kept] = await app.database.db.select().from(messages).where(eq(messages.id, posted.json().id));
    assert.equal(kept.content, 'keep this history');
    assert.equal(kept.deletedAt, null);
    assert.equal(kept.senderId, employee.id);

    const [audit] = await app.database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'admin.user_deleted'));
    assert.equal(audit.targetType, 'user');
    assert.equal(audit.targetId, employee.id);
    assert.equal(audit.actorUserId, adminA.id);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?search=del.employee',
      headers: header(sessionA),
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().data.length, 0);

    const again = await remove(employee.id, sessionA);
    assert.equal(again.statusCode, 404);

    const [first, second] = await Promise.all([remove(extra.id, sessionA), remove(extra.id, sessionB)]);
    const statuses = [first.statusCode, second.statusCode].sort();
    assert.deepEqual(statuses, [200, 404]);
    const [extraRow] = await app.database.db.select().from(users).where(eq(users.id, extra.id));
    assert.ok(extraRow.deletedAt);
  },
);
