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
  'group settings, send restriction, and owner-only admin changes',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'group-settings-secret-value-'.repeat(3),
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );
    const hash = await hashPassword('Group-Settings-Password-9!');
    const people = await app.database.db
      .insert(users)
      .values(
        ['gowner', 'gadmin', 'gmember'].map((username) => ({
          username,
          displayName: username,
          fullName: username,
          passwordHash: hash,
          mustChangePassword: false,
        })),
      )
      .returning();
    const auth = authService(app, config);
    const sessions = await Promise.all(
      people.map((user) =>
        auth.login(
          { username: user.username, password: 'Group-Settings-Password-9!', clientType: 'native', platform: 'android', deviceName: user.username },
          { ip: '127.0.0.1' },
        ),
      ),
    );
    const headers = (index) => ({ authorization: `Bearer ${accessToken(app, sessions[index].user, sessions[index].session)}` });
    const created = await app.inject({ method: 'POST', url: '/api/v1/groups', headers: headers(0), payload: { title: 'Policy group', description: 'Secure' } });
    assert.equal(created.statusCode, 201);
    const group = created.json();
    assert.equal(group.hasAvatar, false);
    assert.equal(group.settings.sendMessages, 'all');
    assert.equal(group.avatarReference, undefined);
    await app.inject({ method: 'POST', url: `/api/v1/groups/${group.id}/members`, headers: headers(0), payload: { userId: people[1].id } });
    await app.inject({ method: 'POST', url: `/api/v1/groups/${group.id}/members`, headers: headers(0), payload: { userId: people[2].id } });
    await app.inject({ method: 'PATCH', url: `/api/v1/groups/${group.id}/members/${people[1].id}/role`, headers: headers(0), payload: { role: 'admin' } });

    assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/groups/${group.id}`, headers: headers(2), payload: { title: 'Hacked' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/groups/${group.id}/settings`, headers: headers(1), payload: { sendMessages: 'admins' } })).statusCode, 403);
    const settings = await app.inject({
      method: 'PATCH',
      url: `/api/v1/groups/${group.id}/settings`,
      headers: headers(0),
      payload: { sendMessages: 'admins', editInfo: 'all', addMembers: 'all' },
    });
    assert.equal(settings.statusCode, 200);
    assert.equal(settings.json().settings.sendMessages, 'admins');
    assert.equal(settings.json().settings.editInfo, 'all');

    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/conversations/${group.id}/messages`,
          headers: headers(2),
          payload: { clientMessageId: randomUUID(), content: 'blocked' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/conversations/${group.id}/messages`,
          headers: headers(1),
          payload: { clientMessageId: randomUUID(), content: 'admin ok' },
        })
      ).statusCode,
      201,
    );
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/groups/${group.id}`, headers: headers(2), payload: { description: 'Member edit' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/groups/${group.id}/members/${people[0].id}/role`, headers: headers(0), payload: { role: 'member' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/groups/${group.id}/members/${people[2].id}/role`, headers: headers(1), payload: { role: 'admin' } })).statusCode, 403);
    const photo = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${group.id}/photo`,
      headers: headers(2),
      payload: { mimeType: 'application/pdf' },
    });
    assert.equal(photo.statusCode, 415);
  },
);
