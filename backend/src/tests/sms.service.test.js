import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from '../config/env.js';
import {
  buildOtpSmsUrl,
  classifySmsFailure,
  otpSmsMessage,
  otpValidityMinutes,
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
  assert.equal(otpValidityMinutes(60), 1);
  assert.equal(
    otpSmsMessage('482193'),
    'Dear Customer, your Code for login to Spa Advisor is 482193. This Code is valid for 1 minutes. Do not share this OTP with anyone. Thank You',
  );
  assert.equal(
    otpSmsMessage('482193', config()),
    'Dear Customer, your Code for login to Spa Advisor is 482193. This Code is valid for 1 minutes. Do not share this OTP with anyone. Thank You',
  );
  assert.equal(toSmsMobile('+919876543210'), '919876543210');
});

test('OTP SMS branding and validity follow configured DLT placeholders', () => {
  const branded = otpSmsMessage('482193', {
    smsBrand: 'MiChat',
    otpTtlSeconds: 120,
    smsOtpTemplate:
      'Dear Customer, your Code for login to {brand} is {code}. This Code is valid for {minutes} minutes. Do not share this OTP with anyone. Thank You',
  });
  assert.equal(
    branded,
    'Dear Customer, your Code for login to MiChat is 482193. This Code is valid for 2 minutes. Do not share this OTP with anyone. Thank You',
  );
  assert.match(branded, /482193/);
  assert.equal(branded.indexOf('MiChat') < branded.indexOf('482193'), true);
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
  const events = [];
  const skipped = smsService(
    config({ SMS_USERNAME: '', SMS_API_KEY: '', SMS_TEMPLATE_ID: '' }),
    { warn: (fields) => events.push(fields.event) },
  );
  assert.equal(skipped.enabled, false);
  assert.deepEqual(await skipped.sendOtp('+919876543210', '123456'), {
    delivered: false,
    outcome: 'unconfigured',
  });
  assert.equal(events.includes('SMS_UNCONFIGURED'), true);

  const testMode = smsService(config({ NODE_ENV: 'test' }), undefined, async () => {
    throw new Error('provider must not be called in tests');
  });
  assert.deepEqual(await testMode.sendOtp('+919876543210', '123456'), {
    delivered: false,
    outcome: 'skipped_test',
  });
});

test('OTP SMS posts the encoded template and treats provider failure as an error', async () => {
  const calls = [];
  const ok = smsService(config(), undefined, async (url, init) => {
    calls.push({ url, init });
    return { ok: true, text: async () => '{"status":"success"}' };
  });
  assert.deepEqual(await ok.sendOtp('+919876543210', '482193'), {
    delivered: true,
    outcome: 'accepted',
  });
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(new URL(calls[0].url).searchParams.get('message'), otpSmsMessage('482193'));

  const rejected = smsService(config(), undefined, async () => ({
    ok: true,
    text: async () => '{"status":"error","message":"invalid"}',
  }));
  await assert.rejects(() => rejected.sendOtp('+919876543210', '482193'), /rejected/);
});

test('OTP SMS classifies timeouts without exposing the request URL', async () => {
  assert.equal(classifySmsFailure({ name: 'TimeoutError', message: 'aborted' }), 'timeout');
  assert.equal(
    classifySmsFailure({
      name: 'TypeError',
      message: 'fetch failed',
      cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'unable to verify the first certificate' },
    }),
    'tls_error',
  );
  const events = [];
  const timedOut = smsService(config({ NODE_ENV: 'development' }), {
    info: (fields) => events.push(fields.event),
    warn: (fields) => events.push(fields.event),
  }, async () => {
    const error = new Error('The operation was aborted');
    error.name = 'TimeoutError';
    throw error;
  });
  await assert.rejects(() => timedOut.sendOtp('+919876543210', '482193'), /failed/);
  assert.deepEqual(events, ['SMS_PROVIDER_ATTEMPTED', 'SMS_TIMEOUT']);
});

test('OTP SMS records a TLS failure without logging provider credentials or URL', async () => {
  const events = [];
  const tlsFailed = smsService(config(), {
    info: (fields) => events.push(fields.event),
    warn: (fields) => events.push(fields.event),
  }, async () => {
    const error = new TypeError('fetch failed');
    error.cause = Object.assign(new Error('unable to verify the first certificate'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    throw error;
  });
  await assert.rejects(
    () => tlsFailed.sendOtp('+919876543210', '123456'),
    (error) => error.smsFailure === 'tls_error',
  );
  assert.deepEqual(events, ['SMS_PROVIDER_ATTEMPTED', 'SMS_TLS_ERROR']);
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
  assert.equal(loaded.smsBrand, 'Spa Advisor');
  assert.equal(loaded.otpTtlSeconds, 60);
  assert.throws(
    () =>
      loadEnv({
        ...base,
        SMS_USERNAME: 'spa-user',
        SMS_API_KEY: 'sms-secret-key',
        SMS_TEMPLATE_ID: '1207160000000000000',
        SMS_OTP_TEMPLATE: 'OTP is missing the placeholder',
      }),
    /SMS_OTP_TEMPLATE/,
  );
});
