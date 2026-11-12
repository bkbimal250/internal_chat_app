import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { conversationMembers, messages, users } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');
const password = 'Hide-Chat-Password-9!';

test(
  'users can hide chats from their own list without deleting history or leaving groups',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'hide-chats-secret-'.repeat(4),
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS hidden_until_seq bigint`,
    );
    await app.database.db.execute(
      sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );

    const hash = await hashPassword(password);
    const [admin, sonam, ravi, deleted] = await app.database.db
      .insert(users)
      .values([
        { username: 'hide.admin', displayName: 'Hide Admin', passwordHash: hash, role: 'admin', mustChangePassword: false },
        { username: 'hide.sonam', displayName: 'Sonam', fullName: 'Sonam Sharma', passwordHash: hash, role: 'user', mustChangePassword: false },
        { username: 'hide.ravi', displayName: 'Ravi', fullName: 'Ravi Kumar', passwordHash: hash, role: 'user', mustChangePassword: false },
        { username: 'hide.gone', displayName: 'Leaver', fullName: 'Gone Employee', passwordHash: hash, role: 'user', mustChangePassword: false },
      ])
      .returning();

    const auth = authService(app, config);
    const login = (username) =>
      auth.login(
        { username, password, clientType: 'native', platform: 'android', deviceName: username },
        { ip: '127.0.0.1' },
      );
    const [adminSession, sonamSession, raviSession] = await Promise.all([
      login('hide.admin'),
      login('hide.sonam'),
      login('hide.ravi'),
    ]);
    const header = (session) => ({ authorization: `Bearer ${accessToken(app, session.user, session.session)}` });
    const sonamH = header(sonamSession);
    const raviH = header(raviSession);
    const adminH = header(adminSession);

    const unauthenticated = await app.inject({ method: 'POST', url: `/api/v1/conversations/${randomUUID()}/hide` });
    assert.equal(unauthenticated.statusCode, 401);

    const asUser = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${deleted.id}`,
      headers: sonamH,
    });
    assert.equal(asUser.statusCode, 403);
    assert.equal(asUser.json().error.code, 'FORBIDDEN');

    const direct = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/conversations/direct',
        headers: sonamH,
        payload: { userId: ravi.id },
      })
    ).json();
    const goneDm = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/conversations/direct',
        headers: sonamH,
        payload: { userId: deleted.id },
      })
    ).json();
    const otherDm = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/conversations/direct',
        headers: raviH,
        payload: { userId: admin.id },
      })
    ).json();

    const send = (conversationId, session, content) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/conversations/${conversationId}/messages`,
        headers: header(session),
        payload: { clientMessageId: randomUUID(), content },
      });

    assert.equal((await send(direct.id, sonamSession, 'keep for ravi')).statusCode, 201);
    assert.equal((await send(direct.id, raviSession, 'unread for sonam')).statusCode, 201);
    assert.equal((await send(goneDm.id, sonamSession, 'old deleted-employee history')).statusCode, 201);
    assert.equal((await send(otherDm.id, raviSession, 'ravi-admin chat')).statusCode, 201);

    const groupReply = await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: sonamH,
      payload: { title: 'Keep me in' },
    });
    assert.equal(groupReply.statusCode, 201);
    const group = groupReply.json();
    assert.equal(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${group.id}/members`,
        headers: sonamH,
        payload: { userId: ravi.id },
      })).statusCode,
      201,
    );
    assert.equal((await send(group.id, raviSession, 'group hello')).statusCode, 201);

    const deletedEmployee = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${deleted.id}`,
      headers: adminH,
    });
    assert.equal(deletedEmployee.statusCode, 200);

    const listedBefore = await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: sonamH });
    assert.equal(listedBefore.statusCode, 200);
    const beforeIds = listedBefore.json().data.map((row) => row.id);
    assert.ok(beforeIds.includes(direct.id));
    assert.ok(beforeIds.includes(goneDm.id));
    assert.ok(beforeIds.includes(group.id));
    const goneRow = listedBefore.json().data.find((row) => row.id === goneDm.id);
    assert.ok(goneRow.members.some((member) => member.fullName === 'Deleted employee' || member.displayName === 'Deleted employee'));
    const unreadDirect = listedBefore.json().data.find((row) => row.id === direct.id);
    assert.ok(unreadDirect.unreadCount >= 1);

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/hide',
      headers: sonamH,
      payload: { conversationIds: [] },
    });
    assert.equal(empty.statusCode, 400);

    const outsider = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${otherDm.id}/hide`,
      headers: sonamH,
    });
    assert.equal(outsider.statusCode, 404);

    const hiddenOne = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${direct.id}/hide`,
      headers: sonamH,
    });
    assert.equal(hiddenOne.statusCode, 200);
    assert.equal(hiddenOne.json().id, direct.id);
    const firstHideSeq = hiddenOne.json().hiddenUntilSeq;
    assert.ok(firstHideSeq >= 1);

    const hiddenAgain = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${direct.id}/hide`,
      headers: sonamH,
    });
    assert.equal(hiddenAgain.statusCode, 200);
    assert.equal(hiddenAgain.json().hiddenUntilSeq, firstHideSeq);

    const bulk = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/hide',
      headers: sonamH,
      payload: { conversationIds: [goneDm.id, group.id, otherDm.id] },
    });
    assert.equal(bulk.statusCode, 200);
    const bulkBody = bulk.json();
    assert.ok(bulkBody.hidden.some((row) => row.id === goneDm.id));
    assert.ok(bulkBody.hidden.some((row) => row.id === group.id));
    assert.ok(bulkBody.failed.some((row) => row.id === otherDm.id));

    const listedAfter = await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: sonamH });
    const afterIds = listedAfter.json().data.map((row) => row.id);
    assert.equal(afterIds.includes(direct.id), false);
    assert.equal(afterIds.includes(goneDm.id), false);
    assert.equal(afterIds.includes(group.id), false);

    const raviList = await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: raviH });
    const raviIds = raviList.json().data.map((row) => row.id);
    assert.ok(raviIds.includes(direct.id));
    assert.ok(raviIds.includes(group.id));
    const raviDirect = raviList.json().data.find((row) => row.id === direct.id);
    assert.equal(raviDirect.latestMessage.content, 'unread for sonam');

    const [sonamDirectMember] = await app.database.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, direct.id), eq(conversationMembers.userId, sonam.id)));
    assert.equal(sonamDirectMember.leftAt, null);
    assert.equal(sonamDirectMember.hiddenUntilSeq, firstHideSeq);

    const [sonamGroupMember] = await app.database.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, group.id), eq(conversationMembers.userId, sonam.id)));
    assert.equal(sonamGroupMember.leftAt, null);
    assert.ok(sonamGroupMember.hiddenUntilSeq > 0);

    const stillGroup = await app.inject({ method: 'GET', url: `/api/v1/groups/${group.id}`, headers: sonamH });
    assert.equal(stillGroup.statusCode, 200);

    const oldHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${direct.id}/messages?afterSeq=0&limit=50`,
      headers: sonamH,
    });
    assert.equal(oldHistory.statusCode, 200);
    assert.equal(oldHistory.json().data.length, 0);

    const raviHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${direct.id}/messages?afterSeq=0&limit=50`,
      headers: raviH,
    });
    assert.ok(raviHistory.json().data.length >= 2);

    const stored = await app.database.db.select().from(messages).where(eq(messages.conversationId, direct.id));
    assert.ok(stored.length >= 2);
    assert.ok(stored.every((row) => row.deletedAt == null));

    const incoming = await send(direct.id, raviSession, 'new after hide');
    assert.equal(incoming.statusCode, 201);
    const listedAgain = await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: sonamH });
    const reappeared = listedAgain.json().data.find((row) => row.id === direct.id);
    assert.ok(reappeared);
    assert.equal(reappeared.latestMessage.content, 'new after hide');
    assert.equal(reappeared.unreadCount, 1);

    const freshHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${direct.id}/messages?afterSeq=0&limit=50`,
      headers: sonamH,
    });
    assert.deepEqual(
      freshHistory.json().data.map((row) => row.content),
      ['new after hide'],
    );

    const leftover = await app.database.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, goneDm.id), eq(conversationMembers.userId, deleted.id), isNull(conversationMembers.leftAt)));
    assert.equal(leftover.length, 1);
  },
);
