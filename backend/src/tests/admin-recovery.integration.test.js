import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { auditLogs, sessions, users } from '../database/schema/index.js';
import { bootstrapAdmin } from '../database/seed/admin.seed.js';
import { assertRecoveryPassword, recoverAdministrator } from '../database/seed/admin-recovery.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../database/seed/recover-admin.js');

test('recovery password policy rejects short secrets without logging them', () => {
  assert.throws(() => assertRecoveryPassword('short'), /12–128/);
  assert.throws(() => assertRecoveryPassword(''), /12–128/);
});

test(
  'administrator recovery resets access without creating accounts',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'admin-recovery-secret-'.repeat(4),
      CORS_ORIGINS: 'http://127.0.0.1:5173',
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );
    const original = 'Original-Admin-Password-9!';
    const recovered = 'Recovered-Admin-Password-9!';
    const boot = await bootstrapAdmin(app.database.db, {
      username: 'recovery-admin',
      password: original,
      displayName: 'Recovery Admin',
    });
    assert.equal(boot.created, true);
    assert.equal(
      (
        await bootstrapAdmin(app.database.db, {
          username: 'another-admin',
          password: original,
          displayName: 'Ignored',
        })
      ).created,
      false,
    );

    const auth = authService(app, config);
    const loggedIn = await auth.login(
      {
        username: 'recovery-admin',
        password: original,
        clientType: 'native',
        platform: 'android',
        deviceName: 'ops-laptop',
      },
      { ip: '127.0.0.1' },
    );
    const oldToken = accessToken(app, loggedIn.user, loggedIn.session);
    const stillValid = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${oldToken}` },
    });
    assert.equal(stillValid.statusCode, 200);

    const [employee] = await app.database.db
      .insert(users)
      .values({
        username: 'recovery-user',
        displayName: 'Not Admin',
        passwordHash: await hashPassword(original),
        role: 'user',
        mustChangePassword: false,
      })
      .returning({ id: users.id });

    await assert.rejects(
      () => recoverAdministrator(app.database.db, { username: 'recovery-user', password: recovered }),
      /Administrator not found/,
    );
    await assert.rejects(
      () => recoverAdministrator(app.database.db, { username: 'missing-admin', password: recovered }),
      /Administrator not found/,
    );

    const result = await recoverAdministrator(app.database.db, {
      username: 'Recovery-Admin',
      password: recovered,
    });
    assert.equal(result.username, 'recovery-admin');
    assert.equal(result.revoked, 1);
    assert.ok(!JSON.stringify(result).toLowerCase().includes('argon2'));
    assert.ok(!JSON.stringify(result).includes(recovered));

    const stale = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${oldToken}` },
    });
    assert.equal(stale.statusCode, 401);
    const [session] = await app.database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, loggedIn.session.id));
    assert.ok(session.revokedAt);
    assert.equal(session.revocationReason, 'admin_recovery');

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'recovery-admin',
        password: original,
        clientType: 'native',
        platform: 'android',
        deviceName: 'ops-laptop',
      },
    });
    assert.equal(oldLogin.statusCode, 401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'recovery-admin',
        password: recovered,
        clientType: 'native',
        platform: 'android',
        deviceName: 'ops-laptop',
      },
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().user.mustChangePassword, true);
    const bearer = { authorization: `Bearer ${login.json().accessToken}` };
    const blocked = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: bearer,
    });
    assert.equal(blocked.statusCode, 403);
    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: bearer,
      payload: { currentPassword: recovered, newPassword: 'Changed-Admin-Password-9!' },
    });
    assert.equal(changed.statusCode, 200);

    const relogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'recovery-admin',
        password: 'Changed-Admin-Password-9!',
        clientType: 'native',
        platform: 'android',
        deviceName: 'ops-laptop',
      },
    });
    assert.equal(relogin.statusCode, 200);
    const adminBearer = { authorization: `Bearer ${relogin.json().accessToken}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: adminBearer,
      payload: {
        username: 'recovery-employee',
        displayName: 'Recovery Employee',
        employeeCode: 'REC-001',
        email: 'recovery.employee@example.test',
        role: 'user',
      },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().user.role, 'user');
    assert.equal(created.json().user.mustChangePassword, true);
    assert.ok(created.json().temporaryPassword.length >= 12);
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: adminBearer,
      payload: { username: 'recovery-employee', displayName: 'Dup' },
    });
    assert.equal(duplicate.statusCode, 409);
    const unauth = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      payload: { username: 'public', displayName: 'Public' },
    });
    assert.equal(unauth.statusCode, 401);

    const [audit] = await app.database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'ops.admin_recovered'));
    assert.equal(audit.targetId, result.userId);
    assert.equal(audit.metadata.reason, 'operator_cli');
    assert.ok(!JSON.stringify(audit).includes(recovered));
    assert.equal(employee.id.length, 36);

    const next = `${recovered}-cli`;
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, '--username', 'recovery-admin', '--confirm'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          LOG_LEVEL: 'silent',
          DATABASE_URL: testUrl,
          JWT_SECRET: config.jwtSecret,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out = [];
      child.stdout.on('data', (chunk) => out.push(chunk));
      child.stderr.on('data', (chunk) => out.push(chunk));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, text: Buffer.concat(out).toString('utf8') }));
      child.stdin.write(`${next}\n${next}\n`);
      child.stdin.end();
    });
    assert.equal(code.status, 0, code.text);
    assert.match(code.text, /Administrator recovered/);
    assert.ok(!code.text.includes(next));
    const afterCli = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'recovery-admin',
        password: next,
        clientType: 'native',
        platform: 'android',
        deviceName: 'ops-laptop',
      },
    });
    assert.equal(afterCli.statusCode, 200);
    assert.equal(afterCli.json().user.mustChangePassword, true);
  },
);

test(
  'recovery CLI refuses to run without an explicit confirm flag',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async () => {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, '--username', 'recovery-admin'], {
        env: { ...process.env, DATABASE_URL: testUrl, JWT_SECRET: 'admin-recovery-secret-'.repeat(4) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out = [];
      child.stdout.on('data', (chunk) => out.push(chunk));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, text: Buffer.concat(out).toString('utf8') }));
      child.stdin.end();
    });
    assert.equal(code.status, 1);
    assert.match(code.text, /--confirm/);
  },
);

test(
  'live Docker API: isolated admin recovery and employee administration',
  {
    skip: !process.env.LIVE_API_URL && 'Set LIVE_API_URL to exercise the running API container',
  },
  async (t) => {
    const base = process.env.LIVE_API_URL.replace(/\/$/, '');
    const config = loadEnv();
    assert.ok(!new URL(config.databaseUrl).pathname.endsWith('_test'));
    const { createDatabase } = await import('../database/index.js');
    const database = createDatabase(config);
    t.after(() => database.close());
    const runId = randomBytes(4).toString('hex');
    const adminUsername = `ops.recovery.${runId}`;
    const employeeUsername = `ops.emp.${runId}`;
    const oldPassword = `Old-Recovery-${runId}-9x!!`;
    const newPassword = `New-Recovery-${runId}-9x!!`;
    const changedPassword = `Chg-Recovery-${runId}-9x!!`;
    const employeeChanged = `Chg-Employee-${runId}-9x!!`;
    await database.db.insert(users).values({
      username: adminUsername,
      displayName: `Ops Recovery ${runId}`,
      passwordHash: await hashPassword(oldPassword),
      role: 'admin',
      mustChangePassword: false,
    });
    const recovered = await recoverAdministrator(database.db, {
      username: adminUsername,
      password: newPassword,
    });
    assert.equal(recovered.username, adminUsername);

    const loginNative = async (username, password, deviceName) => {
      const response = await fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          clientType: 'native',
          platform: 'android',
          deviceName,
        }),
      });
      return { status: response.status, body: await response.json() };
    };
    const bearer = (token) => ({ authorization: `Bearer ${token}` });
    const jsonAuth = (token) => ({ ...bearer(token), 'content-type': 'application/json' });

    const stale = await loginNative(adminUsername, oldPassword, 'ops-verify');
    assert.equal(stale.status, 401);
    const recoveredLogin = await loginNative(adminUsername, newPassword, 'ops-verify');
    assert.equal(recoveredLogin.status, 200);
    assert.equal(recoveredLogin.body.user.mustChangePassword, true);
    const change = await fetch(`${base}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: jsonAuth(recoveredLogin.body.accessToken),
      body: JSON.stringify({ currentPassword: newPassword, newPassword: changedPassword }),
    });
    assert.equal(change.status, 200);
    const admin = await loginNative(adminUsername, changedPassword, 'ops-verify');
    assert.equal(admin.status, 200);
    const adminToken = admin.body.accessToken;

    const created = await fetch(`${base}/api/v1/admin/users`, {
      method: 'POST',
      headers: jsonAuth(adminToken),
      body: JSON.stringify({
        username: employeeUsername,
        displayName: `Ops Employee ${runId}`,
        employeeCode: `OPS-${runId}`,
        email: `ops.emp.${runId}@example.test`,
        role: 'user',
      }),
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201, JSON.stringify({ code: createdBody.error?.code }));
    assert.equal(createdBody.user.role, 'user');
    assert.equal(createdBody.user.mustChangePassword, true);
    const tempPassword = createdBody.temporaryPassword;
    const duplicate = await fetch(`${base}/api/v1/admin/users`, {
      method: 'POST',
      headers: jsonAuth(adminToken),
      body: JSON.stringify({ username: employeeUsername, displayName: 'Dup' }),
    });
    assert.equal(duplicate.status, 409);
    const unauth = await fetch(`${base}/api/v1/admin/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: `ops.public.${runId}`, displayName: 'Public' }),
    });
    assert.equal(unauth.status, 401);

    const employeeLogin = await loginNative(employeeUsername, tempPassword, 'emp-phone');
    assert.equal(employeeLogin.status, 200);
    const forbidden = await fetch(`${base}/api/v1/admin/users`, {
      method: 'POST',
      headers: jsonAuth(employeeLogin.body.accessToken),
      body: JSON.stringify({ username: `ops.denied.${runId}`, displayName: 'Denied' }),
    });
    assert.equal(forbidden.status, 403);
    const employeeChange = await fetch(`${base}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: jsonAuth(employeeLogin.body.accessToken),
      body: JSON.stringify({ currentPassword: tempPassword, newPassword: employeeChanged }),
    });
    assert.equal(employeeChange.status, 200);
    const employee = await loginNative(employeeUsername, employeeChanged, 'emp-phone');
    assert.equal(employee.status, 200);
    const refresh = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientType: 'native', refreshToken: employee.body.refreshToken }),
    });
    const refreshBody = await refresh.json();
    assert.equal(refresh.status, 200);
    const me = await fetch(`${base}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${refreshBody.accessToken}` },
    });
    assert.equal(me.status, 200);
    const replay = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientType: 'native', refreshToken: employee.body.refreshToken }),
    });
    assert.equal(replay.status, 401);
    const listed = await fetch(`${base}/api/v1/admin/users?search=${employeeUsername}`, {
      headers: bearer(adminToken),
    });
    assert.equal(listed.status, 200);
    const employeeId = createdBody.user.id;
    const suspended = await fetch(`${base}/api/v1/admin/users/${employeeId}/suspend`, {
      method: 'POST',
      headers: bearer(adminToken),
    });
    assert.equal(suspended.status, 200);
    const blockedLogin = await loginNative(employeeUsername, employeeChanged, 'emp-phone');
    assert.equal(blockedLogin.status, 401);
    const reactivated = await fetch(`${base}/api/v1/admin/users/${employeeId}/reactivate`, {
      method: 'POST',
      headers: bearer(adminToken),
    });
    assert.equal(reactivated.status, 200);
    const reset = await fetch(`${base}/api/v1/admin/users/${employeeId}/reset-password`, {
      method: 'POST',
      headers: bearer(adminToken),
    });
    const resetBody = await reset.json();
    assert.equal(reset.status, 200);
    assert.ok(resetBody.temporaryPassword);
    const afterReset = await loginNative(employeeUsername, resetBody.temporaryPassword, 'emp-phone');
    assert.equal(afterReset.status, 200);
    const revoked = await fetch(`${base}/api/v1/admin/users/${employeeId}/sessions`, {
      method: 'DELETE',
      headers: bearer(adminToken),
    });
    assert.equal(revoked.status, 200);
    const revokedMe = await fetch(`${base}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${afterReset.body.accessToken}` },
    });
    assert.equal(revokedMe.status, 401);
    const logoutLogin = await loginNative(adminUsername, changedPassword, 'ops-verify-2');
    const logout = await fetch(`${base}/api/v1/auth/logout`, {
      method: 'POST',
      headers: bearer(logoutLogin.body.accessToken),
    });
    assert.equal(logout.status, 200);
    const afterLogout = await fetch(`${base}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${logoutLogin.body.accessToken}` },
    });
    assert.equal(afterLogout.status, 401);
    await fetch(`${base}/api/v1/admin/users/${employeeId}/suspend`, {
      method: 'POST',
      headers: bearer(adminToken),
    });
    await fetch(`${base}/api/v1/admin/users/${recovered.userId}/suspend`, {
      method: 'POST',
      headers: bearer(adminToken),
    });
  },
);
