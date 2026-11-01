import assert from 'node:assert/strict';
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

async function person(app, config, username, fullName) {
  const password = 'Notify-Password-9!';
  const [user] = await app.database.db
    .insert(users)
    .values({
      username,
      displayName: username,
      fullName,
      passwordHash: await hashPassword(password),
      mustChangePassword: false,
    })
    .returning();
  const session = await authService(app, config).login(
    { username, password, clientType: 'native', platform: 'android', deviceName: 'Pixel' },
    { ip: '127.0.0.1' },
  );
  return {
    user,
    auth: (method, url, payload) =>
      app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${accessToken(app, session.user, session.session)}` },
        payload,
      }),
  };
}

test(
  'message push skips the sender, muted peers, and hidden previews',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'message-notify-secret-value-'.repeat(3),
      FIREBASE_SERVICE_ACCOUNT_PATH: '',
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, conversation_members, conversations, messages, notification_preferences, users restart identity cascade`,
    );

    const sent = [];
    app.push.sendToUser = async (userId, payload) => {
      sent.push({ userId, payload });
      return { sent: 1 };
    };

    const sonam = await person(app, config, 'sonam.notify', 'Sonam Sharma');
    const ravi = await person(app, config, 'ravi.notify', 'Ravi Patel');
    const direct = await sonam.auth('POST', '/api/v1/conversations/direct', { userId: ravi.user.id });
    assert.ok([200, 201].includes(direct.statusCode));
    const conversationId = direct.json().id;

    const first = await sonam.auth('POST', `/api/v1/conversations/${conversationId}/messages`, {
      clientMessageId: '11111111-1111-4111-8111-111111111111',
      content: 'Hey, please check the latest project update.',
    });
    assert.equal(first.statusCode, 201);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].userId, ravi.user.id);
    assert.equal(sent[0].payload.title, 'Sonam Sharma');
    assert.equal(sent[0].payload.body, 'Hey, please check the latest project update.');
    assert.equal(sent[0].payload.data.conversationId, conversationId);
    assert.ok(!sent.some((row) => row.userId === sonam.user.id));

    const prefs = await ravi.auth('PATCH', '/api/v1/notification-preferences', { showPreview: false });
    assert.equal(prefs.statusCode, 200);
    assert.equal(prefs.json().showPreview, false);

    sent.length = 0;
    const hidden = await sonam.auth('POST', `/api/v1/conversations/${conversationId}/messages`, {
      clientMessageId: '22222222-2222-4222-8222-222222222222',
      content: 'Confidential update',
    });
    assert.equal(hidden.statusCode, 201);
    assert.equal(sent[0].payload.title, 'Company Chat');
    assert.equal(sent[0].payload.body, 'New message');
    assert.equal(sent[0].payload.data.senderName, undefined);

    const muted = await ravi.auth('POST', `/api/v1/conversations/${conversationId}/mute`, { muted: true });
    assert.equal(muted.statusCode, 200);
    assert.equal(muted.json().muted, true);

    sent.length = 0;
    const ignored = await sonam.auth('POST', `/api/v1/conversations/${conversationId}/messages`, {
      clientMessageId: '33333333-3333-4333-8333-333333333333',
      content: 'Should be muted',
    });
    assert.equal(ignored.statusCode, 201);
    assert.equal(sent.length, 0);

    await ravi.auth('POST', `/api/v1/conversations/${conversationId}/mute`, { muted: false });
    await ravi.auth('PATCH', '/api/v1/notification-preferences', { messagesEnabled: false, showPreview: true });
    sent.length = 0;
    const disabled = await sonam.auth('POST', `/api/v1/conversations/${conversationId}/messages`, {
      clientMessageId: '44444444-4444-4444-8444-444444444444',
      content: 'Notifications off',
    });
    assert.equal(disabled.statusCode, 201);
    assert.equal(sent.length, 0);
  },
);
