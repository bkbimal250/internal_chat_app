import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { messages, users } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';
import { retentionService } from '../modules/retention/retention.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');

test(
  '90-day retention stays in preview until an admin approves cleanup',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'retention-integration-secret-'.repeat(3),
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table notifications, retention_reminders, retention_jobs, retention_exports, retention_holds, audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );
    await app.database.db.execute(
      sql`insert into retention_policies (id, retention_days, reminders_enabled, cleanup_enabled, existing_grace_days, legal_hold)
          values ('default', 90, true, false, 90, false)
          on conflict (id) do update set cleanup_enabled = false, retention_days = 90, reminders_enabled = true, legal_hold = false`,
    );

    const password = 'Retention-Password-9!';
    const hash = await hashPassword(password);
    const [admin, member] = await app.database.db
      .insert(users)
      .values([
        { username: 'ret-admin', displayName: 'Ret Admin', passwordHash: hash, role: 'admin', mustChangePassword: false },
        { username: 'ret-user', displayName: 'Ret User', passwordHash: hash, mustChangePassword: false },
      ])
      .returning();
    const auth = authService(app, config);
    const login = (user) =>
      auth.login(
        { username: user.username, password, clientType: 'native', platform: 'android', deviceName: user.username },
        { ip: '127.0.0.1' },
      );
    const [adminSession, userSession] = await Promise.all([login(admin), login(member)]);
    const header = (session) => ({ authorization: `Bearer ${accessToken(app, session.user, session.session)}` });
    const asAdmin = (method, url, payload) =>
      app.inject({ method, url, headers: header(adminSession), payload });
    const asUser = (method, url, payload) => app.inject({ method, url, headers: header(userSession), payload });

    const policy = (await asUser('GET', '/api/v1/retention/policy')).json();
    assert.equal(policy.retentionDays, 90);
    assert.equal(policy.cleanupEnabled, false);

    const forbidden = await asUser('POST', '/api/v1/admin/retention/activate');
    assert.equal(forbidden.statusCode, 403);

    const direct = (await asAdmin('POST', '/api/v1/conversations/direct', { userId: member.id })).json();
    const created = await asAdmin('POST', `/api/v1/conversations/${direct.id}/messages`, {
      clientMessageId: randomUUID(),
      content: 'keep this until approved',
    });
    assert.equal(created.statusCode, 201);
    const message = created.json();
    assert.ok(message.expiresAt);
    const deadline = new Date(message.expiresAt).getTime() - new Date(message.createdAt).getTime();
    assert.ok(deadline >= 89 * 86400000);

    await app.database.db
      .update(messages)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(messages.id, message.id));

    const service = retentionService(app, config);
    const previewCycle = await service.cycle();
    assert.equal(previewCycle.expire.stats.mode, 'preview');
    const stillThere = await app.database.db.select().from(messages).where(eq(messages.id, message.id));
    assert.equal(stillThere[0].expiredAt, null);

    const preview = (await asAdmin('GET', '/api/v1/admin/retention')).json();
    assert.equal(preview.preview.mode, 'preview');
    assert.ok(preview.preview.eligibleMessages >= 1);

    const reminderExpires = new Date(Date.now() + 30 * 86400000 - 60000);
    await app.database.db.update(messages).set({ expiresAt: reminderExpires }).where(eq(messages.id, message.id));
    const firstReminders = await service.sendReminders();
    const secondReminders = await service.sendReminders();
    assert.ok((firstReminders.stats?.sent ?? 0) >= 1);
    assert.equal(secondReminders.stats?.sent ?? 0, 0);

    const notes = (await asUser('GET', '/api/v1/notifications')).json();
    assert.ok(notes.some((row) => String(row.type).startsWith('retention.reminder')));

    await asAdmin('PATCH', '/api/v1/admin/retention', { retentionDays: 180 });
    const afterPolicy = await app.database.db.select().from(messages).where(eq(messages.id, message.id));
    assert.ok(new Date(afterPolicy[0].expiresAt).getTime() >= new Date(message.createdAt).getTime() + 179 * 86400000);

    await asAdmin('PATCH', '/api/v1/admin/retention', { retentionDays: 90 });
    await app.database.db
      .update(messages)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(messages.id, message.id));

    const activated = await asAdmin('POST', '/api/v1/admin/retention/activate');
    assert.equal(activated.statusCode, 200);
    assert.equal(activated.json().cleanupEnabled, true);

    const expired = await service.expireDue({ force: true });
    assert.ok((expired.stats?.expired ?? 0) >= 1);
    const listed = await asUser('GET', `/api/v1/conversations/${direct.id}/messages?limit=50`);
    assert.equal(listed.json().data.some((row) => row.id === message.id), false);
    const synced = await asUser('GET', `/api/v1/conversations/${direct.id}/sync?limit=50`);
    const expiredRow = synced.json().data.find((row) => row.id === message.id);
    assert.ok(expiredRow?.expiredAt);

    const exportJob = await asUser('POST', `/api/v1/conversations/${direct.id}/export`);
    assert.equal(exportJob.statusCode, 202);
    if (app.storage.enabled) {
      await service.fulfillExports();
      const exportStatus = (await asUser('GET', `/api/v1/exports/${exportJob.json().id}`)).json();
      assert.ok(['pending', 'running', 'ready', 'failed'].includes(exportStatus.status));
    }

    await asAdmin('POST', '/api/v1/admin/retention/pause');
    await asAdmin('POST', '/api/v1/admin/retention/holds', {
      conversationId: direct.id,
      reason: 'legal hold for investigation',
    });
    const held = await service.expireDue({ force: true });
    assert.ok(held.skipped === 'legal_hold' || (held.stats?.expired ?? 0) === 0);

    await asAdmin('PATCH', '/api/v1/admin/retention', { legalHold: false });
    await asAdmin('POST', '/api/v1/admin/retention/pause');
  },
);
