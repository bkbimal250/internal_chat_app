import assert from 'node:assert/strict';
import test from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { devices, users } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');

test(
  'native sessions can register a push token for the current device',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'push-token-integration-secret-'.repeat(3),
      FIREBASE_SERVICE_ACCOUNT_PATH: '',
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );
    const password = 'Push-Token-Password-9!';
    const [user] = await app.database.db
      .insert(users)
      .values({
        username: 'push-user',
        displayName: 'Push User',
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
      })
      .returning();
    const session = await authService(app, config).login(
      { username: user.username, password, clientType: 'native', platform: 'android', deviceName: 'Pixel' },
      { ip: '127.0.0.1' },
    );
    const token = `fcm-test-token-${'x'.repeat(24)}`;
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/devices/push-token',
      headers: { authorization: `Bearer ${accessToken(app, session.user, session.session)}` },
      payload: { token },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().registered, true);
    const [device] = await app.database.db
      .select()
      .from(devices)
      .where(eq(devices.id, session.session.deviceId));
    assert.equal(device.pushToken, token);
  },
);
