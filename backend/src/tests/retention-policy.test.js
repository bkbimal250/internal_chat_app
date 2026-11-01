import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RETENTION_DAYS,
  REMINDER_WINDOWS,
  addDays,
  assertRetentionDays,
  expiresAtForExistingMessage,
  expiresAtForNewMessage,
  nextExpiresAtOnPolicyChange,
  reminderDue,
} from '../services/retention-policy.js';

test('new messages expire exactly after the configured retention days', () => {
  const created = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(expiresAtForNewMessage(created, 90).toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(expiresAtForNewMessage(created, 30).toISOString(), '2026-01-31T00:00:00.000Z');
  assert.equal(DEFAULT_RETENTION_DAYS, 90);
});

test('original creation timestamp remains authoritative after later edits', () => {
  const created = new Date('2026-01-01T00:00:00.000Z');
  const edited = new Date('2026-02-01T00:00:00.000Z');
  assert.equal(expiresAtForNewMessage(created, 90).toISOString(), '2026-04-01T00:00:00.000Z');
  assert.notEqual(expiresAtForNewMessage(edited, 90).toISOString(), '2026-04-01T00:00:00.000Z');
});

test('existing history receives a grace floor instead of immediate deletion', () => {
  const created = new Date('2024-01-01T00:00:00.000Z');
  const now = new Date('2026-10-31T00:00:00.000Z');
  const expires = expiresAtForExistingMessage(created, now, 90, 90);
  assert.equal(expires.toISOString(), addDays(now, 90).toISOString());
});

test('policy changes never silently shorten an already-open deadline below now', () => {
  const created = new Date('2026-10-01T00:00:00.000Z');
  const now = new Date('2026-10-31T00:00:00.000Z');
  const current = addDays(created, 90);
  const next = nextExpiresAtOnPolicyChange(current, created, now, 30);
  assert.equal(next.toISOString(), current.toISOString());
});

test('reminder windows fire 30, 7, and 1 day before expiry', () => {
  const expires = new Date('2026-12-01T00:00:00.000Z');
  assert.deepEqual(
    REMINDER_WINDOWS.map((window) => window.daysBefore),
    [30, 7, 1],
  );
  assert.equal(reminderDue(expires, new Date('2026-11-01T00:00:00.000Z'), 30), true);
  assert.equal(reminderDue(expires, new Date('2026-11-24T00:00:00.000Z'), 7), true);
  assert.equal(reminderDue(expires, new Date('2026-11-30T00:00:00.000Z'), 1), true);
  assert.equal(reminderDue(expires, new Date('2026-12-01T00:00:00.000Z'), 1), false);
});

test('retention days are limited to the approved company policies', () => {
  assert.equal(assertRetentionDays(90), 90);
  assert.throws(() => assertRetentionDays(45));
});
