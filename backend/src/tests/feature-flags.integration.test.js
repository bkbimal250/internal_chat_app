import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
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
  'disabled attachment flag blocks uploads without breaking text chat',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'feature-flags-secret-'.repeat(4),
      CHAT_ATTACHMENTS_ENABLED: 'false',
      CALLS_ENABLED: 'false',
    });
    assert.equal(config.chatAttachmentsEnabled, false);
    assert.equal(config.callsEnabled, false);

    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table attachments, audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );

    const password = 'Flags-Password-9!';
    const hash = await hashPassword(password);
    const [owner, peer] = await app.database.db
      .insert(users)
      .values([
        { username: 'flag-a', displayName: 'Flag A', passwordHash: hash, mustChangePassword: false },
        { username: 'flag-b', displayName: 'Flag B', passwordHash: hash, mustChangePassword: false },
      ])
      .returning();
    const auth = authService(app, config);
    const login = (user, device) =>
      auth.login(
        { username: user.username, password, clientType: 'native', platform: 'android', deviceName: device },
        { ip: '127.0.0.1' },
      );
    const sessionA = await login(owner, 'a1');
    const token = accessToken(app, sessionA.user, sessionA.session);
    const headers = { authorization: `Bearer ${token}` };

    const ready = await app.inject('/health/ready');
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().attachmentsEnabled, false);
    assert.equal(ready.json().callsEnabled, false);

    const conversation = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/direct',
      headers,
      payload: { userId: peer.id },
    });
    assert.equal(conversation.statusCode, 201);
    const conversationId = conversation.json().id;

    const text = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers,
      payload: { clientMessageId: randomUUID(), content: 'text still works' },
    });
    assert.equal(text.statusCode, 201, text.body);
    assert.equal(text.json().content, 'text still works');
    assert.equal(text.json().messageType, 'text');

    const init = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/attachments`,
      headers,
      payload: { fileName: 'pixel.png', mimeType: 'image/png', sizeBytes: 12 },
    });
    assert.equal(init.statusCode, 503);
    assert.equal(init.json().error.code, 'ATTACHMENTS_DISABLED');

    const parts = await app.inject({
      method: 'POST',
      url: `/api/v1/attachments/${randomUUID()}/parts`,
      headers,
      payload: { partNumbers: [1] },
    });
    assert.equal(parts.statusCode, 503);
    assert.equal(parts.json().error.code, 'ATTACHMENTS_DISABLED');
  },
);
