import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { bootstrapAdmin } from '../database/seed/admin.seed.js';
import { users, sessions, auditLogs } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const phase2 = testUrl && new URL(testUrl).pathname.endsWith('_test');
const secret = 'phase-two-integration-secret-'.repeat(4);
let app;
let config;
const password = 'Correct-Horse-Battery-7!';

// DB migration is intentionally external; this suite refuses every non-dedicated database.
test(
  'Phase 2 PostgreSQL integration',
  { skip: !phase2 && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: secret,
      CORS_ORIGINS: 'https://web.test',
      DB_POOL_MAX: '20',
    });
    app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );

    const boot = await bootstrapAdmin(app.database.db, {
      username: 'admin',
      password,
      displayName: 'Initial Admin',
    });
    assert.equal(boot.created, true);
    assert.equal(
      (
        await bootstrapAdmin(app.database.db, {
          username: 'admin2',
          password,
          displayName: 'Ignored',
        })
      ).created,
      false,
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'ADMIN',
        password,
        clientType: 'native',
        platform: 'android',
        deviceName: 'Admin phone',
      },
    });
    assert.equal(login.statusCode, 200);
    const firstTokens = login.json();
    const firstBearer = { authorization: `Bearer ${firstTokens.accessToken}` };
    const adminChanged = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: firstBearer,
      payload: { currentPassword: password, newPassword: 'Admin-Changed-Password-9!' },
    });
    assert.equal(adminChanged.statusCode, 200);
    const adminRelogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'admin',
        password: 'Admin-Changed-Password-9!',
        clientType: 'native',
        platform: 'android',
        deviceName: 'Admin phone',
      },
    });
    assert.equal(adminRelogin.statusCode, 200);
    const bearer = { authorization: `Bearer ${adminRelogin.json().accessToken}` };

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: bearer,
      payload: {
        username: 'employee',
        displayName: 'Employee One',
        employeeCode: 'E001',
      },
    });
    assert.equal(created.statusCode, 201);
    const employee = created.json();
    assert.equal(employee.user.role, 'user');
    assert.ok(employee.temporaryPassword);
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: bearer,
      payload: {
        username: 'EMPLOYEE',
        displayName: 'Duplicate',
      },
    });
    assert.equal(duplicate.statusCode, 409);
    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'employee',
        password: 'not-the-password',
        clientType: 'native',
        platform: 'android',
        deviceName: 'Bad',
      },
    });
    assert.equal(badLogin.statusCode, 401);
    assert.equal(badLogin.json().error.message, 'Invalid credentials');

    const userLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'employee',
        password: employee.temporaryPassword,
        clientType: 'native',
        platform: 'android',
        deviceName: 'Employee phone',
      },
    });
    assert.equal(userLogin.statusCode, 200);
    const userTokens = userLogin.json();
    const userBearer = { authorization: `Bearer ${userTokens.accessToken}` };
    const blocked = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: userBearer,
    });
    assert.equal(blocked.statusCode, 403);
    const mustChange = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: userBearer,
    });
    assert.equal(mustChange.statusCode, 403);
    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: userBearer,
      payload: {
        currentPassword: employee.temporaryPassword,
        newPassword: 'Employee-Changed-Password-9!',
      },
    });
    assert.equal(changed.statusCode, 200);
    const invalidated = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: userBearer,
    });
    assert.equal(invalidated.statusCode, 401);
    const relogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'employee',
        password: 'Employee-Changed-Password-9!',
        clientType: 'native',
        platform: 'android',
        deviceName: 'Employee phone',
      },
    });
    assert.equal(relogin.statusCode, 200);
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {
        clientType: 'native',
        refreshToken: relogin.json().refreshToken,
      },
    });
    assert.equal(refresh.statusCode, 200);
    const reused = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {
        clientType: 'native',
        refreshToken: relogin.json().refreshToken,
      },
    });
    assert.equal(reused.statusCode, 401);
    const rotatedInvalid = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${refresh.json().accessToken}` },
    });
    assert.equal(rotatedInvalid.statusCode, 401);

    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${employee.user.id}/reset-password`,
      headers: bearer,
    });
    assert.equal(reset.statusCode, 200);
    const suspended = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${employee.user.id}/suspend`,
      headers: bearer,
    });
    assert.equal(suspended.statusCode, 200);
    const suspendedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'employee',
        password: reset.json().temporaryPassword,
        clientType: 'native',
        platform: 'android',
        deviceName: 'Employee phone',
      },
    });
    assert.equal(suspendedLogin.statusCode, 401);
    const reactivated = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${employee.user.id}/reactivate`,
      headers: bearer,
    });
    assert.equal(reactivated.statusCode, 200);
    const [events] = await app.database.db.select({ count: sql`count(*)::int` }).from(auditLogs);
    assert.ok(events.count >= 6);

    const limitHash = await hashPassword('Session-Limit-Password-9!');
    const [limitUser] = await app.database.db
      .insert(users)
      .values({
        username: `limit-${randomUUID().slice(0, 8)}`,
        displayName: 'Limit User',
        passwordHash: limitHash,
        mustChangePassword: false,
      })
      .returning();
    const { authService } = await import('../modules/auth/auth.service.js');
    const service = authService(app, config);
    const logins = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        service.login(
          {
            username: limitUser.username,
            password: 'Session-Limit-Password-9!',
            clientType: 'native',
            platform: 'android',
            deviceName: `Device ${i}`,
          },
          { ip: '127.0.0.1' },
        ),
      ),
    );
    assert.equal(logins.length, 50);
    await assert.rejects(
      () =>
        service.login(
          {
            username: limitUser.username,
            password: 'Session-Limit-Password-9!',
            clientType: 'native',
            platform: 'android',
            deviceName: 'Device 51',
          },
          { ip: '127.0.0.1' },
        ),
      { code: 'SESSION_LIMIT' },
    );
    const [count] = await app.database.db
      .select({ count: sql`count(*)::int` })
      .from(sessions)
      .where(eq(sessions.userId, limitUser.id));
    assert.equal(count.count, 50);
  },
);
