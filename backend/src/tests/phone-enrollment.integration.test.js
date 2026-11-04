import test from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { users, otpChallenges } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');
const secret = 'phone-enrollment-integration-secret-'.repeat(2);
const password = 'Admin-Phone-Password-9!';

test(
  'first admin enrolls a phone, then OTP login works',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: secret,
      CORS_ORIGINS: 'https://web.test',
      OTP_RATE_LIMIT: '100',
      OTP_TTL_SECONDS: '60',
      OTP_RESEND_SECONDS: '15',
      OTP_MAX_ATTEMPTS: '3',
      OTP_MAX_PER_HOUR: '5',
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table otp_challenges, audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );

    const passwordHash = await hashPassword(password);
    const [admin] = await app.database.db
      .insert(users)
      .values({
        username: 'bootstrap.admin',
        displayName: 'Bootstrap Admin',
        fullName: 'Bootstrap Admin',
        passwordHash,
        role: 'admin',
        mustChangePassword: false,
      })
      .returning();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'bootstrap.admin',
        password,
        clientType: 'native',
        platform: 'android',
        deviceName: 'Admin',
      },
    });
    assert.equal(login.statusCode, 200);
    const bearer = { authorization: `Bearer ${login.json().accessToken}` };
    assert.equal(login.json().user.phoneE164, null);
    assert.equal(login.json().user.phoneVerifiedAt, null);

    const blocked = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: bearer,
      payload: { phone: '+15551230001' },
    });
    assert.equal(blocked.statusCode, 400);
    assert.equal(blocked.json().error.code, 'PHONE_VERIFICATION_REQUIRED');
    const [unchanged] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, admin.id));
    assert.equal(unchanged.phoneE164, null);
    assert.equal(unchanged.phoneVerifiedAt, null);

    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/phone/otp',
      payload: { phone: '+15551230001' },
    });
    assert.equal(anonymous.statusCode, 401);

    const unknownLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '+15551230001' },
    });
    assert.equal(unknownLogin.statusCode, 200);
    assert.equal(unknownLogin.json().accepted, true);
    assert.equal(app.otpInbox.get('code:+15551230001'), undefined);

    const requested = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/phone/otp',
      headers: bearer,
      payload: { phone: '+15551230001' },
    });
    assert.equal(requested.statusCode, 200);
    assert.equal(requested.json().accepted, true);
    const enrollCode = app.otpInbox.get('code:enroll:+15551230001');
    assert.match(enrollCode, /^\d{6}$/);
    assert.equal(requested.body.includes(enrollCode), false);

    const resend = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/phone/otp',
      headers: bearer,
      payload: { phone: '+15551230001' },
    });
    assert.equal(resend.statusCode, 200);
    assert.equal(app.otpInbox.get('code:enroll:+15551230001'), enrollCode);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/phone/verify',
      headers: bearer,
      payload: { phone: '+15551230001', code: '000000' },
    });
    assert.equal(invalid.statusCode, 401);
    assert.equal(invalid.json().error.code, 'INVALID_OTP');

    await app.database.db
      .update(otpChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(otpChallenges.phoneE164, '+15551230001'));
    const expired = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/phone/verify',
      headers: bearer,
      payload: { phone: '+15551230001', code: enrollCode },
    });
    assert.equal(expired.statusCode, 401);

    await app.database.db.execute(sql`update otp_challenges set last_sent_at = now() - interval '20 seconds'`);
    const retry = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/phone/otp',
      headers: bearer,
      payload: { phone: '+15551230001' },
    });
    assert.equal(retry.statusCode, 200);
    const freshCode = app.otpInbox.get('code:enroll:+15551230001');
    assert.match(freshCode, /^\d{6}$/);
    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/phone/verify',
      headers: bearer,
      payload: { phone: '+15551230001', code: freshCode },
    });
    assert.equal(verified.statusCode, 200);
    assert.equal(verified.json().phoneE164, '+15551230001');
    assert.ok(verified.json().phoneVerifiedAt);

    const loginOtp = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '+15551230001' },
    });
    assert.equal(loginOtp.statusCode, 200);
    const loginCode = app.otpInbox.get('code:+15551230001');
    assert.match(loginCode, /^\d{6}$/);
    const otpSession = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: {
        phone: '+15551230001',
        code: loginCode,
        clientType: 'native',
        platform: 'android',
        deviceName: 'OTP login',
      },
    });
    assert.equal(otpSession.statusCode, 200);
    assert.equal(otpSession.json().user.username, 'bootstrap.admin');

    const otherHash = await hashPassword('Other-User-Password-9!');
    const [other] = await app.database.db
      .insert(users)
      .values({
        username: 'other.user',
        displayName: 'Other',
        fullName: 'Other',
        passwordHash: otherHash,
        role: 'user',
        mustChangePassword: false,
      })
      .returning();
    const otherLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'other.user',
        password: 'Other-User-Password-9!',
        clientType: 'native',
        platform: 'android',
        deviceName: 'Other',
      },
    });
    const otherBearer = { authorization: `Bearer ${otherLogin.json().accessToken}` };
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/phone/otp',
      headers: otherBearer,
      payload: { phone: '+15551230001' },
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().error.code, 'PHONE_IN_USE');

    const escalate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${other.id}`,
      headers: otherBearer,
      payload: { role: 'admin' },
    });
    assert.equal(escalate.statusCode, 403);

    const selfRole = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: otherBearer,
      payload: { role: 'admin' },
    });
    assert.equal(selfRole.statusCode, 400);

    const publicRegister = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      payload: { username: 'public.user', displayName: 'Public', role: 'admin' },
    });
    assert.equal(publicRegister.statusCode, 401);

    const lastAdmin = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${admin.id}`,
      headers: bearer,
      payload: { role: 'user' },
    });
    assert.equal(lastAdmin.statusCode, 409);
    assert.equal(lastAdmin.json().error.code, 'LAST_ADMIN');
  },
);
