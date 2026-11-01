import test from 'node:test';
import assert from 'node:assert/strict';
import { cookieOptions, persistentCookieOptions } from '../plugins/authentication.js';

test('development cookies are host-only, HttpOnly, and not Secure', () => {
  const options = cookieOptions({ nodeEnv: 'development' });
  assert.equal(options.path, '/api/v1/auth');
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, false);
  assert.equal(options.sameSite, 'strict');
  assert.equal('maxAge' in options, false);
});

test('production cookies require the Secure flag', () => {
  const options = cookieOptions({ nodeEnv: 'production' });
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, 'strict');
});

test('persistent cookies use remaining session lifetime instead of extending it', () => {
  const expires = new Date(Date.now() + 12 * 86400000);
  const options = persistentCookieOptions({ nodeEnv: 'development', refreshTokenDays: 30 }, expires);
  assert.equal(options.expires.getTime(), expires.getTime());
  assert.ok(options.maxAge > 11 * 86400);
  assert.ok(options.maxAge <= 12 * 86400);
});
