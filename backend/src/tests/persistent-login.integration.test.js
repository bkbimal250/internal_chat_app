import test from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { hashPassword } from '../services/password.service.js';
import { users } from '../database/schema/index.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');
const secret = 'persistent-login-secret-value-'.repeat(4);
const password = 'Persistent-Login-Password-9!';
const origin = 'http://127.0.0.1:5173';

function parseCookies(headers) {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((line) => {
    const parts = String(line).split(';').map((part) => part.trim());
    const [pair, ...attributes] = parts;
    const separator = pair.indexOf('=');
    const cookie = {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      attrs: {},
    };
    for (const attribute of attributes) {
      const [key, val] = attribute.split('=');
      cookie.attrs[key.toLowerCase()] = val ?? true;
    }
    return cookie;
  });
}

function cookieHeader(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

test(
  'web refresh cookies persist for the session lifetime and rotate without extending it',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: secret,
      CORS_ORIGINS: origin,
      REFRESH_TOKEN_DAYS: '30',
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );
    await app.database.db.insert(users).values({
      username: 'persist.user',
      displayName: 'Persist User',
      passwordHash: await hashPassword(password),
      mustChangePassword: false,
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin, 'x-requested-with': 'company-chat' },
      payload: {
        username: 'persist.user',
        password,
        clientType: 'web',
        platform: 'web',
        deviceName: 'Chrome',
      },
    });
    assert.equal(login.statusCode, 200);
    const cookies = parseCookies(login.headers);
    const refresh = cookies.find((cookie) => cookie.name === 'chat_refresh');
    const csrf = cookies.find((cookie) => cookie.name === 'chat_csrf');
    assert.ok(refresh);
    assert.ok(csrf);
    assert.equal(refresh.attrs.httponly, true);
    assert.equal(refresh.attrs.path, '/api/v1/auth');
    assert.equal(refresh.attrs.samesite, 'Strict');
    assert.ok(Number(refresh.attrs['max-age']) > 29 * 86400);
    assert.ok(refresh.attrs.expires);
    assert.equal(csrf.attrs.httponly, undefined);
    assert.equal(csrf.attrs.path, '/');
    assert.equal(login.json().refreshToken, undefined);

    const expiredJwt = app.jwt.sign(
      { sub: login.json().user.id, sid: login.json().sessionId },
      { expiresIn: -1 },
    );
    const expiredMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${expiredJwt}` },
    });
    assert.equal(expiredMe.statusCode, 401);

    const refreshHeaders = {
      origin,
      'x-requested-with': 'company-chat',
      'x-csrf-token': login.json().csrfToken,
      cookie: cookieHeader([refresh, csrf]),
    };
    const rotated = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: refreshHeaders,
      payload: { clientType: 'web' },
    });
    assert.equal(rotated.statusCode, 200);
    const rotatedCookie = parseCookies(rotated.headers).find((cookie) => cookie.name === 'chat_refresh');
    assert.ok(rotatedCookie);
    assert.ok(Number(rotatedCookie.attrs['max-age']) <= 30 * 86400);

    const restored = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${rotated.json().accessToken}` },
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().username, 'persist.user');

    const cookieOnly = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        origin,
        'x-requested-with': 'company-chat',
        cookie: cookieHeader(parseCookies(rotated.headers)),
      },
      payload: { clientType: 'web' },
    });
    assert.equal(cookieOnly.statusCode, 200);
    assert.ok(cookieOnly.json().accessToken);
    assert.equal(cookieOnly.json().user.username, 'persist.user');

    const rotatedRefresh = parseCookies(rotated.headers).find((cookie) => cookie.name === 'chat_refresh');
    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: {
        origin,
        'x-requested-with': 'company-chat',
        cookie: `${rotatedRefresh.name}=${rotatedRefresh.value}`,
      },
      payload: { clientType: 'web' },
    });
    assert.equal(missingCsrf.statusCode, 403);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: refreshHeaders,
      payload: { clientType: 'web' },
    });
    assert.equal(replay.statusCode, 401);

    const afterReplay = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${rotated.json().accessToken}` },
    });
    assert.equal(afterReplay.statusCode, 401);
  },
);
