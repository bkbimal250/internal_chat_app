import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import Fastify from 'fastify';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { startServer } from '../server.js';
import { installErrorHandler } from '../middleware/error-handler.js';

// A bound TCP socket never accepts PostgreSQL: failure tests cannot reach a real DB.
async function unavailableDatabase(t) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return loadEnv({
    JWT_SECRET: 'foundation-test-only-secret-'.repeat(4),
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: `postgresql://test:secret@127.0.0.1:${server.address().port}/foundation_test`,
    DB_CONNECT_TIMEOUT_MS: '100',
    DB_QUERY_TIMEOUT_MS: '100',
  });
}

test('environment validation rejects missing and invalid configuration without secrets', () => {
  assert.throws(() => loadEnv({}), /DATABASE_URL/);
  assert.throws(
    () => loadEnv({ DATABASE_URL: 'SECRET_VALUE', PORT: 'bad' }),
    (error) => error.message.includes('PORT') && !error.message.includes('SECRET_VALUE'),
  );
  assert.throws(() => loadEnv({ DATABASE_URL: 'https://user:pass@host/db' }), /DATABASE_URL/);
  assert.throws(() => loadEnv({ NODE_ENV: 'unknown', DB_POOL_MAX: '0' }), /NODE_ENV/);
  assert.throws(() => loadEnv({ CORS_ORIGINS: '*' }), /CORS_ORIGINS/);
});

test('environment safely encodes Compose credentials and supplies defaults', () => {
  const config = loadEnv({
    JWT_SECRET: 'foundation-test-only-secret-'.repeat(4),
    POSTGRES_USER: 'chat',
    POSTGRES_PASSWORD: 'a@b:#/?',
    POSTGRES_DB: 'company_chat',
  });
  assert.equal(new URL(config.databaseUrl).password, 'a%40b%3A%23%2F%3F');
  assert.equal(config.port, 3001);
  assert.ok(Object.isFrozen(config));
});

test('application initializes; liveness is independent of database; readiness fails safely', async (t) => {
  const config = await unavailableDatabase(t);
  const app = await buildApp({ config });
  t.after(() => app.close());
  assert.ok(app.database.db);
  const live = await app.inject({
    method: 'GET',
    url: '/health/live',
    headers: {
      'x-request-id': 'untrusted-id',
    },
  });
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json(), { status: 'ok', service: 'company-chat-api' });
  assert.ok(live.headers['x-request-id']);
  assert.notEqual(live.headers['x-request-id'], 'untrusted-id');
  assert.equal(live.headers['x-content-type-options'], 'nosniff');
  const ready = await app.inject('/health/ready');
  assert.equal(ready.statusCode, 503);
  assert.equal(ready.json().database, 'disconnected');
  assert.equal(ready.json().error.requestId, ready.headers['x-request-id']);
  assert.ok(!ready.body.includes('secret'));
  const missing = await app.inject('/missing');
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'NOT_FOUND');
});

test('startup rejects a failed real database connection and closes its pool', async (t) => {
  const config = await unavailableDatabase(t);
  await assert.rejects(startServer(config));
});

for (const nodeEnv of ['development', 'production']) {
  test(`central errors and schema validation in ${nodeEnv}`, async (t) => {
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    t.after(() => app.close());
    installErrorHandler(app, { nodeEnv });
    app.get('/error', async () => {
      throw new Error('password=secret');
    });
    app.post(
      '/validate',
      {
        schema: {
          body: {
            type: 'object',
            required: ['value'],
            additionalProperties: false,
            properties: { value: { type: 'integer' } },
          },
        },
      },
      async () => ({ ok: true }),
    );
    const failed = await app.inject('/error');
    assert.equal(failed.statusCode, 500);
    assert.ok(!failed.body.includes('secret'));
    const invalid = await app.inject({ method: 'POST', url: '/validate', payload: {} });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, 'VALIDATION_ERROR');
    assert.equal(Boolean(invalid.json().error.details), nodeEnv !== 'production');
    const extra = await app.inject({
      method: 'POST',
      url: '/validate',
      payload: { value: 1, extra: true },
    });
    assert.equal(extra.statusCode, 400);
  });
}

test('production does not auto-create S3 buckets unless S3_CREATE_BUCKET is set', () => {
  const required = {
    NODE_ENV: 'production',
    JWT_SECRET: 'foundation-test-only-secret-'.repeat(4),
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
    SMS_USERNAME: 'user',
    SMS_API_KEY: 'key',
    SMS_TEMPLATE_ID: 'tmpl',
    S3_ENDPOINT: 'https://s3.example.com',
    S3_ACCESS_KEY: 'access',
    S3_SECRET_KEY: 'secret-key',
  };
  assert.equal(loadEnv(required).s3CreateBucket, false);
  assert.equal(loadEnv({ ...required, S3_CREATE_BUCKET: '1' }).s3CreateBucket, true);
  const aws = loadEnv({
    ...required,
    S3_ENDPOINT: '',
    S3_PUBLIC_ENDPOINT: '',
    S3_REGION: 'ap-south-1',
    S3_FORCE_PATH_STYLE: 'false',
    S3_CREATE_BUCKET: 'false',
  });
  assert.equal(aws.s3Endpoint, '');
  assert.equal(aws.s3ForcePathStyle, false);
  assert.equal(aws.s3CreateBucket, false);
  assert.equal(aws.chatAttachmentsEnabled, false);
  assert.equal(aws.callsEnabled, false);
});

test(
  'real PostgreSQL readiness and pool shutdown',
  {
    skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a dedicated *_test database',
  },
  async (t) => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname, /_test$/, 'Integration database name must end in _test');
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: url.href,
      JWT_SECRET: 'foundation-test-only-secret-'.repeat(4),
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    const ready = await app.inject('/health/ready');
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), {
      status: 'ready',
      database: 'connected',
      storage: 'unconfigured',
      attachmentsEnabled: true,
      callsEnabled: true,
    });
    await app.close();
    await assert.rejects(app.database.check());
  },
);
