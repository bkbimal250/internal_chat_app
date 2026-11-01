import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { users } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');

test(
  'WhatsApp-style hide, delete-for-everyone, reactions, and private replies',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'message-actions-secret-'.repeat(3),
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );
    const password = 'Message-Actions-Password-9!';
    const hash = await hashPassword(password);
    const [a, b, c] = await app.database.db
      .insert(users)
      .values(
        ['act-a', 'act-b', 'act-c'].map((username) => ({
          username,
          displayName: username,
          passwordHash: hash,
          mustChangePassword: false,
        })),
      )
      .returning();
    const auth = authService(app, config);
    const login = (user) =>
      auth.login(
        { username: user.username, password, clientType: 'native', platform: 'android', deviceName: user.username },
        { ip: '127.0.0.1' },
      );
    const [sessionA, sessionB, sessionC] = await Promise.all([login(a), login(b), login(c)]);
    const header = (session) => ({ authorization: `Bearer ${accessToken(app, session.user, session.session)}` });
    const post = (url, session, payload) => app.inject({ method: 'POST', url, headers: header(session), payload });

    const direct = (
      await post('/api/v1/conversations/direct', sessionA, { userId: b.id })
    ).json();
    const group = (await post('/api/v1/groups', sessionA, { title: 'Actions group' })).json();
    assert.equal((await post(`/api/v1/groups/${group.id}/members`, sessionA, { userId: b.id })).statusCode, 201);

    const groupPosted = await post(`/api/v1/conversations/${group.id}/messages`, sessionB, {
      clientMessageId: randomUUID(),
      content: 'group hello',
    });
    assert.equal(groupPosted.statusCode, 201);
    const groupMessage = groupPosted.json();

    const everyoneInGroup = await app.inject({
      method: 'DELETE',
      url: `/api/v1/messages/${groupMessage.id}`,
      headers: header(sessionB),
    });
    assert.equal(everyoneInGroup.statusCode, 403);
    assert.equal(everyoneInGroup.json().error.code, 'DELETE_FOR_EVERYONE_NOT_ALLOWED');

    const hideInGroup = await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${groupMessage.id}/hide`,
      headers: header(sessionA),
    });
    assert.equal(hideInGroup.statusCode, 200);
    assert.equal(hideInGroup.json().hidden, true);
    const aGroupHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${group.id}/messages?afterSeq=0&limit=50`,
      headers: header(sessionA),
    });
    assert.equal(
      aGroupHistory.json().data.some((row) => row.id === groupMessage.id),
      false,
    );
    const bGroupHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${group.id}/messages?afterSeq=0&limit=50`,
      headers: header(sessionB),
    });
    assert.equal(
      bGroupHistory.json().data.some((row) => row.id === groupMessage.id),
      true,
    );
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/messages/${groupMessage.id}`,
          headers: header(sessionA),
        })
      ).statusCode,
      404,
    );

    const visibleGroup = (
      await post(`/api/v1/conversations/${group.id}/messages`, sessionB, {
        clientMessageId: randomUUID(),
        content: 'quote me privately',
      })
    ).json();
    const privateReply = await post(`/api/v1/conversations/${direct.id}/messages`, sessionA, {
      clientMessageId: randomUUID(),
      content: 'private quote',
      replyToMessageId: visibleGroup.id,
    });
    assert.equal(privateReply.statusCode, 201);
    assert.equal(privateReply.json().replyTo?.id, visibleGroup.id);
    assert.equal(privateReply.json().replyTo?.content, 'quote me privately');

    const outsiderDirect = (await post('/api/v1/conversations/direct', sessionA, { userId: c.id })).json();
    assert.equal(
      (
        await post(`/api/v1/conversations/${outsiderDirect.id}/messages`, sessionA, {
          clientMessageId: randomUUID(),
          content: 'wrong private reply',
          replyToMessageId: visibleGroup.id,
        })
      ).statusCode,
      400,
    );

    const directMessage = (
      await post(`/api/v1/conversations/${direct.id}/messages`, sessionA, {
        clientMessageId: randomUUID(),
        content: 'direct delete me',
      })
    ).json();
    const hideDirect = await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${directMessage.id}/hide`,
      headers: header(sessionB),
    });
    assert.equal(hideDirect.statusCode, 200);
    const bDirectHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${direct.id}/messages?afterSeq=0&limit=50`,
      headers: header(sessionB),
    });
    assert.equal(
      bDirectHistory.json().data.some((row) => row.id === directMessage.id),
      false,
    );
    const aDirectHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${direct.id}/messages?afterSeq=0&limit=50`,
      headers: header(sessionA),
    });
    assert.ok(aDirectHistory.json().data.some((row) => row.id === directMessage.id));

    const everyoneDirect = await app.inject({
      method: 'DELETE',
      url: `/api/v1/messages/${directMessage.id}`,
      headers: header(sessionA),
    });
    assert.equal(everyoneDirect.statusCode, 200);
    assert.ok(everyoneDirect.json().deletedAt);
    assert.equal(everyoneDirect.json().content, '');

    const reactable = (
      await post(`/api/v1/conversations/${direct.id}/messages`, sessionA, {
        clientMessageId: randomUUID(),
        content: 'react to this',
      })
    ).json();
    const reacted = await post(`/api/v1/messages/${reactable.id}/reactions`, sessionB, { emoji: '👍' });
    assert.equal(reacted.statusCode, 200);
    assert.equal(reacted.json().reactions[0].emoji, '👍');
    assert.equal(reacted.json().reactions[0].count, 1);
    assert.ok(reacted.json().reactions[0].userIds.includes(b.id));
    const replaced = await post(`/api/v1/messages/${reactable.id}/reactions`, sessionB, { emoji: '❤️' });
    assert.equal(replaced.json().reactions[0].emoji, '❤️');
    const toggled = await post(`/api/v1/messages/${reactable.id}/reactions`, sessionB, { emoji: '❤️' });
    assert.equal(toggled.json().reactions.length, 0);
    assert.equal(
      (await post(`/api/v1/messages/${reactable.id}/reactions`, sessionB, { emoji: '🔥' })).statusCode,
      400,
    );
    assert.equal(
      (await post(`/api/v1/messages/${reactable.id}/reactions`, sessionC, { emoji: '👍' })).statusCode,
      404,
    );
  },
);
