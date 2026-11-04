import test from 'node:test';
import assert from 'node:assert/strict';
import { CSRF_COOKIE, REFRESH_COOKIE, checkCsrf, csrfFromRequest } from '../plugins/authentication.js';
import { csrfToken } from '../services/token.service.js';
import { AppError } from '../utils/app-error.js';

const secret = 'csrf-cookie-secret-value-'.repeat(4);
const origin = 'https://web.michat.in';
const config = { corsOrigins: [origin], jwtSecret: secret };
const refresh = 'A'.repeat(64);
const csrf = csrfToken(refresh, secret);

function request({ header, cookie, originHeader = origin, refreshToken = refresh } = {}) {
  return {
    headers: {
      origin: originHeader,
      ...(header ? { 'x-csrf-token': header } : {}),
    },
    cookies: {
      ...(refreshToken ? { [REFRESH_COOKIE]: refreshToken } : {}),
      ...(cookie ? { [CSRF_COOKIE]: cookie } : {}),
    },
  };
}

function assertCsrfFailed(fn) {
  assert.throws(fn, (error) => error instanceof AppError && error.statusCode === 403 && error.code === 'CSRF_FAILED');
}

test('CSRF values are read from the header first and the cookie second', () => {
  assert.equal(csrfFromRequest(request({ header: 'header-token', cookie: 'cookie-token' })), 'header-token');
  assert.equal(csrfFromRequest(request({ cookie: 'cookie-token' })), 'cookie-token');
});

test('CSRF header matching the refresh HMAC is accepted', () => {
  assert.doesNotThrow(() => checkCsrf(request({ header: csrf }), config));
});

test('CSRF cookie matching the refresh HMAC is accepted without a header', () => {
  assert.doesNotThrow(() => checkCsrf(request({ cookie: csrf }), config));
});

test('either a valid header or a valid cookie is enough after rotation in another tab', () => {
  assert.doesNotThrow(() => checkCsrf(request({ header: 'stale-header', cookie: csrf }), config));
});

test('CSRF is rejected when neither header nor cookie matches', () => {
  assertCsrfFailed(() => checkCsrf(request({ header: 'wrong', cookie: 'wrong' }), config));
});

test('CSRF is rejected when the refresh cookie is missing', () => {
  assertCsrfFailed(() => checkCsrf(request({ header: csrf, cookie: csrf, refreshToken: '' }), config));
});

test('CSRF still requires an allowed web origin', () => {
  assert.throws(
    () => checkCsrf(request({ cookie: csrf, originHeader: 'https://evil.example' }), config),
    (error) => error instanceof AppError && error.code === 'ORIGIN_FORBIDDEN',
  );
});
