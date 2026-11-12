import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { conversationMembers, users } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');
const password = 'Chat-Action-Password-9!';

test(
  'users can pin, mute, archive and unread only their own chats',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'chat-actions-secret-'.repeat(4),
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS hidden_until_seq bigint`,
    );
    await app.database.db.execute(
      sql`ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS pinned_at timestamptz`,
    );
    await app.database.db.execute(
      sql`ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS archived_at timestamptz`,
    );
    await app.database.db.execute(
      sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );

    const hash = await hashPassword(password);
    const [sonam, ravi] = await app.database.db
      .insert(users)
      .values([
        { username: 'act.sonam', displayName: 'Sonam', fullName: 'Sonam Sharma', passwordHash: hash, role: 'user', mustChangePassword: false },
        { username: 'act.ravi', displayName: 'Ravi', fullName: 'Ravi Kumar', passwordHash: hash, role: 'user', mustChangePassword: false },
      ])
      .returning();

    const auth = authService(app, config);
    const login = (username) =>
      auth.login(
        { username, password, clientType: 'native', platform: 'android', deviceName: username },
        { ip: '127.0.0.1' },
      );
    const [sonamSession, raviSession] = await Promise.all([login('act.sonam'), login('act.ravi')]);
    const header = (session) => ({ authorization: `Bearer ${accessToken(app, session.user, session.session)}` });
    const sonamH = header(sonamSession);
    const raviH = header(raviSession);

    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/conversations/${randomUUID()}/pin`, payload: { pinned: true } })).statusCode, 401);

    const one = (await app.inject({ method: 'POST', url: '/api/v1/conversations/direct', headers: sonamH, payload: { userId: ravi.id } })).json();
    const two = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: sonamH,
        payload: { title: 'Pinned group' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${one.id}/messages`,
      headers: sonamH,
      payload: { clientMessageId: randomUUID(), content: 'hello ravi' },
    });

    const outsider = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${two.id}/pin`,
      headers: raviH,
      payload: { pinned: true },
    });
    assert.equal(outsider.statusCode, 404);

    const pinned = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/pin',
      headers: sonamH,
      payload: { conversationIds: [one.id, two.id], pinned: true },
    });
    assert.equal(pinned.statusCode, 200);
    assert.equal(pinned.json().pinned.length, 2);

    const muted = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/mute',
      headers: sonamH,
      payload: { conversationIds: [one.id], muted: true },
    });
    assert.equal(muted.statusCode, 200);
    assert.equal(muted.json().muted[0].muted, true);

    const inbox = await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: sonamH });
    const inboxIds = inbox.json().data.map((row) => row.id);
    assert.equal(inboxIds[0], two.id);
    assert.ok(inbox.json().data.find((row) => row.id === one.id).pinnedAt);
    assert.ok(inbox.json().data.find((row) => row.id === one.id).mutedUntil);

    const archived = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/archive',
      headers: sonamH,
      payload: { conversationIds: [one.id], archived: true },
    });
    assert.equal(archived.statusCode, 200);

    const afterArchive = await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: sonamH });
    assert.equal(afterArchive.json().data.some((row) => row.id === one.id), false);
    const archivedList = await app.inject({ method: 'GET', url: '/api/v1/conversations?archived=true', headers: sonamH });
    const archivedRow = archivedList.json().data.find((row) => row.id === one.id);
    assert.ok(archivedRow);
    assert.equal(archivedRow.pinnedAt, null);

    const raviInbox = await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: raviH });
    assert.ok(raviInbox.json().data.some((row) => row.id === one.id));
    assert.equal(raviInbox.json().data.find((row) => row.id === one.id).archivedAt, null);

    await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/archive',
      headers: sonamH,
      payload: { conversationIds: [one.id], archived: false },
    });
    const unread = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${one.id}/unread`,
      headers: sonamH,
    });
    assert.equal(unread.statusCode, 200);
    const marked = await app.inject({ method: 'GET', url: '/api/v1/conversations', headers: sonamH });
    assert.ok((marked.json().data.find((row) => row.id === one.id).unreadCount ?? 0) >= 0);

    const [sonamMember] = await app.database.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, one.id), eq(conversationMembers.userId, sonam.id)));
    assert.ok(sonamMember.lastReadSeq < (sonamMember.lastReadSeq + 1));
    const [raviMember] = await app.database.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, one.id), eq(conversationMembers.userId, ravi.id)));
    assert.equal(raviMember.archivedAt, null);
    assert.equal(raviMember.pinnedAt, null);
  },
);
