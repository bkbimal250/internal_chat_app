import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from '../config/env.js';
import {
  buildOtpSmsUrl,
  otpSmsMessage,
  smsService,
  toSmsMobile,
} from '../services/sms.service.js';

const secret = 'sms-service-test-only-secret-'.repeat(4);

function config(overrides = {}) {
  return loadEnv({
    JWT_SECRET: secret,
    NODE_ENV: 'development',
    LOG_LEVEL: 'silent',
    POSTGRES_USER: 'chat',
    POSTGRES_PASSWORD: 'secret',
    POSTGRES_DB: 'company_chat',
    SMS_USERNAME: 'spa-user',
    SMS_API_KEY: 'sms-secret-key',
    SMS_TEMPLATE_ID: '1207160000000000000',
    ...overrides,
  });
}

test('OTP SMS uses the registered Spa Advisor DLT template', () => {
  assert.equal(
    otpSmsMessage('482193'),
    'Dear Customer, your Code for login to Spa Advisor is 482193. This Code is valid for 1 minutes. Do not share this OTP with anyone. Thank You',
  );
  assert.equal(toSmsMobile('+919876543210'), '919876543210');
});

test('OTP SMS URL matches the Hilite HTTP API contract', () => {
  const url = new URL(buildOtpSmsUrl(config(), '+919876543210', '482193'));
  assert.equal(url.origin + url.pathname, 'https://www.hilitemultimedia.co.in/websms/api/http/index.php');
  assert.equal(url.searchParams.get('username'), 'spa-user');
  assert.equal(url.searchParams.get('apikey'), 'sms-secret-key');
  assert.equal(url.searchParams.get('apirequest'), 'Text');
  assert.equal(url.searchParams.get('route'), 'ServiceImplicit');
  assert.equal(url.searchParams.get('TemplateID'), '1207160000000000000');
  assert.equal(url.searchParams.get('sender'), 'SPAADV');
  assert.equal(url.searchParams.get('mobile'), '919876543210');
  assert.equal(
    url.searchParams.get('message'),
    otpSmsMessage('482193'),
  );
  assert.match(url.search, /message=Dear%20Customer/);
});

test('OTP SMS is skipped without credentials or in tests', async () => {
  const skipped = smsService(config({ SMS_USERNAME: '', SMS_API_KEY: '', SMS_TEMPLATE_ID: '' }));
  assert.equal(skipped.enabled, false);
  assert.deepEqual(await skipped.sendOtp('+919876543210', '123456'), { delivered: false });

  const testMode = smsService(config({ NODE_ENV: 'test' }), undefined, async () => {
    throw new Error('provider must not be called in tests');
  });
  assert.deepEqual(await testMode.sendOtp('+919876543210', '123456'), { delivered: false });
});

test('OTP SMS posts the encoded template and treats provider failure as an error', async () => {
  const calls = [];
  const ok = smsService(config(), undefined, async (url, init) => {
    calls.push({ url, init });
    return { ok: true, text: async () => '{"status":"success"}' };
  });
  assert.deepEqual(await ok.sendOtp('+919876543210', '482193'), { delivered: true });
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(new URL(calls[0].url).searchParams.get('message'), otpSmsMessage('482193'));

  const rejected = smsService(config(), undefined, async () => ({
    ok: true,
    text: async () => '{"status":"error","message":"invalid"}',
  }));
  await assert.rejects(() => rejected.sendOtp('+919876543210', '482193'), /rejected/);
});

test('production requires Hilite SMS credentials instead of Twilio', () => {
  const base = {
    JWT_SECRET: secret,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
    S3_ENDPOINT: 'http://storage:4566',
    S3_ACCESS_KEY: 'key',
    S3_SECRET_KEY: 'secret',
  };
  assert.throws(() => loadEnv(base), /SMS username/);
  const loaded = loadEnv({
    ...base,
    SMS_USERNAME: 'spa-user',
    SMS_API_KEY: 'sms-secret-key',
    SMS_TEMPLATE_ID: '1207160000000000000',
  });
  assert.equal(loaded.smsSender, 'SPAADV');
  assert.equal(loaded.otpTtlSeconds, 60);
});
