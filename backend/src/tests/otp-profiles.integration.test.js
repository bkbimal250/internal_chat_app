import test from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { users, otpChallenges, sessions } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { normalizePhone } from '../services/phone.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');
const secret = 'otp-profile-integration-secret-'.repeat(3);
const password = 'Otp-Profile-Password-9!';

test(
  'OTP login, profile fields, and admin employee lifecycle',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: secret,
      CORS_ORIGINS: 'https://web.test',
      OTP_RATE_LIMIT: '100',
      OTP_TTL_SECONDS: '120',
      OTP_RESEND_SECONDS: '15',
      OTP_MAX_ATTEMPTS: '3',
      OTP_MAX_PER_HOUR: '5',
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table otp_challenges, audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );

    assert.equal(normalizePhone('+91 98765 43210'), '+919876543210');
    assert.throws(() => normalizePhone('12345'), /valid phone/);

    const passwordHash = await hashPassword(password);
    const [admin] = await app.database.db
      .insert(users)
      .values({
        username: 'otp.admin',
        displayName: 'OTP Admin',
        fullName: 'OTP Admin',
        passwordHash,
        role: 'admin',
        mustChangePassword: false,
      })
      .returning();
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'otp.admin',
        password,
        clientType: 'native',
        platform: 'android',
        deviceName: 'Admin',
      },
    });
    assert.equal(adminLogin.statusCode, 200);
    const adminBearer = { authorization: `Bearer ${adminLogin.json().accessToken}` };

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: adminBearer,
      payload: {
        username: 'otp.employee',
        displayName: 'OTP Employee',
        fullName: 'OTP Employee Full',
        phone: '+15551230001',
        address: '1 Test Street',
        email: 'otp.employee@example.test',
        password: 'Assigned-Temp-Pass-9!',
      },
    });
    assert.equal(created.statusCode, 201);
    const employee = created.json();
    assert.equal(employee.temporaryPassword, 'Assigned-Temp-Pass-9!');
    assert.equal(employee.user.phoneE164, '+15551230001');
    assert.equal(employee.user.fullName, 'OTP Employee Full');
    assert.equal(employee.user.phoneVerifiedAt, null);
    await app.database.db
      .update(users)
      .set({ phoneVerifiedAt: new Date() })
      .where(eq(users.id, employee.user.id));

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '+15550000000' },
    });
    assert.equal(unknown.statusCode, 200);
    assert.equal(unknown.json().accepted, true);
    assert.equal(app.otpInbox.get('code:+15550000000'), undefined);

    const requested = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '+15551230001' },
    });
    assert.equal(requested.statusCode, 200);
    assert.deepEqual(Object.keys(requested.json()).sort(), [
      'accepted',
      'expiresInSeconds',
      'retryAfterSeconds',
    ]);
    const code = app.otpInbox.get('code:+15551230001');
    assert.match(code, /^\d{6}$/);
    assert.equal(requested.body.includes(code), false);

    const cooldown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '+15551230001' },
    });
    assert.equal(cooldown.statusCode, 200);
    assert.equal(app.otpInbox.get('code:+15551230001'), code);

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: {
        phone: '+15551230001',
        code: '000000',
        clientType: 'native',
        platform: 'android',
        deviceName: 'Phone',
      },
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.json().error.code, 'INVALID_CREDENTIALS');

    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: {
        phone: '+15551230001',
        code,
        clientType: 'native',
        platform: 'android',
        deviceName: 'Phone',
      },
    });
    assert.equal(verified.statusCode, 200);
    assert.equal(verified.json().user.username, 'otp.employee');
    assert.equal(verified.json().user.mustChangePassword, true);
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: {
        phone: '+15551230001',
        code,
        clientType: 'native',
        platform: 'android',
        deviceName: 'Phone replay',
      },
    });
    assert.equal(replay.statusCode, 401);

    await app.database.db.execute(sql`update otp_challenges set last_sent_at = now() - interval '20 seconds'`);
    const secondRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '+15551230001' },
    });
    assert.equal(secondRequest.statusCode, 200);
    const secondCode = app.otpInbox.get('code:+15551230001');
    assert.match(secondCode, /^\d{6}$/);
    await app.database.db
      .update(otpChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(otpChallenges.phoneE164, '+15551230001'));
    const expired = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: {
        phone: '+15551230001',
        code: secondCode,
        clientType: 'native',
        platform: 'android',
        deviceName: 'Expired',
      },
    });
    assert.equal(expired.statusCode, 401);

    await app.database.db.execute(sql`update otp_challenges set last_sent_at = now() - interval '20 seconds'`);
    const attemptRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '+15551230001' },
    });
    assert.equal(attemptRequest.statusCode, 200);
    const attemptCode = app.otpInbox.get('code:+15551230001');
    for (let i = 0; i < 6; i += 1) {
      const failed = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/verify',
        payload: {
          phone: '+15551230001',
          code: '111111',
          clientType: 'native',
          platform: 'android',
          deviceName: 'Attempts',
        },
      });
      assert.equal(failed.statusCode, 401);
    }
    const locked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: {
        phone: '+15551230001',
        code: attemptCode,
        clientType: 'native',
        platform: 'android',
        deviceName: 'Attempts',
      },
    });
    assert.equal(locked.statusCode, 401);

    const profile = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/' + employee.user.id,
      headers: adminBearer,
      payload: { address: '2 Updated Street', displayName: 'Updated Employee' },
    });
    assert.equal(profile.statusCode, 200);
    assert.equal(profile.json().address, '2 Updated Street');

    const selfLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'otp.employee',
        password: 'Assigned-Temp-Pass-9!',
        clientType: 'native',
        platform: 'android',
        deviceName: 'Self',
      },
    });
    assert.equal(selfLogin.statusCode, 200);
    const blockedProfile = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${selfLogin.json().accessToken}` },
      payload: { fullName: 'Blocked Name' },
    });
    assert.equal(blockedProfile.statusCode, 403);
    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${selfLogin.json().accessToken}` },
      payload: {
        currentPassword: 'Assigned-Temp-Pass-9!',
        newPassword: 'Employee-Changed-Password-9!',
      },
    });
    assert.equal(changed.statusCode, 200);
    const selfRelogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'otp.employee',
        password: 'Employee-Changed-Password-9!',
        clientType: 'native',
        platform: 'android',
        deviceName: 'Self',
      },
    });
    assert.equal(selfRelogin.statusCode, 200);
    const selfUpdate = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${selfRelogin.json().accessToken}` },
      payload: { fullName: 'Self Updated Name' },
    });
    assert.equal(selfUpdate.statusCode, 200);
    assert.equal(selfUpdate.json().fullName, 'Self Updated Name');

    const duplicatePhone = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: adminBearer,
      payload: {
        username: 'otp.other',
        displayName: 'Other',
        phone: '+15551230001',
      },
    });
    assert.equal(duplicatePhone.statusCode, 409);

    const lastAdmin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${admin.id}`,
      headers: adminBearer,
    });
    assert.equal(lastAdmin.statusCode, 403);
    assert.equal(lastAdmin.json().error.code, 'CANNOT_DELETE_SELF');

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${employee.user.id}/suspend`,
      headers: adminBearer,
    });
    const suspendedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'otp.employee',
        password: 'Employee-Changed-Password-9!',
        clientType: 'native',
        platform: 'android',
        deviceName: 'Suspended',
      },
    });
    assert.equal(suspendedLogin.statusCode, 401);
    await app.database.db.execute(sql`update otp_challenges set last_sent_at = now() - interval '20 seconds'`);
    const suspendedOtp = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '+15551230001' },
    });
    assert.equal(suspendedOtp.statusCode, 200);
    assert.equal(app.otpInbox.get('code:+15551230001'), attemptCode);

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${employee.user.id}/reactivate`,
      headers: adminBearer,
    });
    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${employee.user.id}/reset-password`,
      headers: adminBearer,
      payload: { password: 'Reset-By-Admin-9x!!' },
    });
    assert.equal(reset.statusCode, 200);
    assert.equal(reset.json().temporaryPassword, 'Reset-By-Admin-9x!!');

    const [limitUser] = await app.database.db
      .insert(users)
      .values({
        username: 'otp.limit',
        displayName: 'Limit',
        fullName: 'Limit',
        phoneE164: '+15551239999',
        phoneVerifiedAt: new Date(),
        passwordHash,
        mustChangePassword: false,
      })
      .returning();
    const { authService } = await import('../modules/auth/auth.service.js');
    const service = authService(app, config);
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        service.login(
          {
            username: limitUser.username,
            password,
            clientType: 'native',
            platform: 'android',
            deviceName: `Limit ${i}`,
          },
          { ip: '127.0.0.1' },
        ),
      ),
    );
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '+15551239999' },
    });
    const limitCode = app.otpInbox.get('code:+15551239999');
    const limitVerify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: {
        phone: '+15551239999',
        code: limitCode,
        clientType: 'native',
        platform: 'android',
        deviceName: 'Overflow',
      },
    });
    assert.equal(limitVerify.statusCode, 409);
    assert.equal(limitVerify.json().error.code, 'SESSION_LIMIT');
    const [count] = await app.database.db
      .select({ count: sql`count(*)::int` })
      .from(sessions)
      .where(eq(sessions.userId, limitUser.id));
    assert.equal(count.count, 50);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${employee.user.id}`,
      headers: adminBearer,
    });
    assert.equal(removed.statusCode, 200);
    const gone = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/users/${employee.user.id}`,
      headers: adminBearer,
    });
    assert.equal(gone.statusCode, 404);
    const deletedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'otp.employee',
        password: 'Reset-By-Admin-9x!!',
        clientType: 'native',
        platform: 'android',
        deviceName: 'Deleted',
      },
    });
    assert.equal(deletedLogin.statusCode, 401);

    for (let i = 0; i < 5; i += 1) {
      const burst = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/request',
        payload: { phone: '+15550001111' },
      });
      assert.equal(burst.statusCode, 200);
      await app.database.db.execute(
        sql`update otp_challenges set last_sent_at = now() - interval '20 seconds' where phone_e164 = '+15550001111'`,
      );
    }
    const hourly = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { phone: '+15550001111' },
    });
    assert.equal(hourly.statusCode, 429);
  },
);
