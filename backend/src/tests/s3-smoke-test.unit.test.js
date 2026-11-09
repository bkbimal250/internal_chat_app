import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SMOKE_PREFIX,
  assertAllowedSmokeKey,
  awsConfigFromEnv,
  createSmokeKey,
  main,
  parseSmokeArgs,
  publicSmokeSummary,
  runS3SmokeTest,
} from '../../scripts/s3-smoke-test.js';

const payload = Buffer.from('michat-smoke-test');

function mockSend({ getBody = payload, failPut = false, failGet = false, failDelete = false } = {}) {
  const commands = [];
  async function send(command) {
    commands.push({
      name: command.constructor.name,
      bucket: command.input?.Bucket,
      key: command.input?.Key,
      encryption: command.input?.ServerSideEncryption,
    });
    if (command.constructor.name === 'HeadBucketCommand') return {};
    if (command.constructor.name === 'PutObjectCommand') {
      if (failPut) throw Object.assign(new Error('denied'), { name: 'AccessDenied' });
      return {};
    }
    if (command.constructor.name === 'GetObjectCommand') {
      if (failGet) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { Body: getBody };
    }
    if (command.constructor.name === 'DeleteObjectCommand') {
      if (failDelete) throw Object.assign(new Error('denied'), { name: 'AccessDenied' });
      return {};
    }
    throw Object.assign(new Error('unexpected'), { name: 'UnexpectedCommand' });
  }
  return { send, commands };
}

test('parseSmokeArgs is read-only unless --allow-write is present', () => {
  assert.deepEqual(parseSmokeArgs([]), { help: false, allowWrite: false });
  assert.deepEqual(parseSmokeArgs(['--allow-write']), { help: false, allowWrite: true });
  assert.deepEqual(parseSmokeArgs(['--help']), { help: true, allowWrite: false });
  assert.throws(() => parseSmokeArgs(['--force']), /Unknown argument/);
});

test('smoke keys stay under michat-smoke-test/ and reject unrelated keys', () => {
  const key = createSmokeKey(new Date('2026-11-09T12:00:00.000Z'), Buffer.from('a'.repeat(16)));
  assert.equal(key.startsWith(SMOKE_PREFIX), true);
  assert.doesNotThrow(() => assertAllowedSmokeKey(key));
  assert.throws(() => assertAllowedSmokeKey('att/2026/11/secret.bin'));
  assert.throws(() => assertAllowedSmokeKey('michat-smoke-test/../other.bin'));
  assert.throws(() => assertAllowedSmokeKey('michat-smoke-test/nested/path.bin'));
  assert.throws(() => assertAllowedSmokeKey(`${SMOKE_PREFIX}`));
});

test('awsConfigFromEnv uses blank AWS endpoints and does not echo secrets', () => {
  const config = awsConfigFromEnv({
    S3_BUCKET: 'michat-main-bucket',
    S3_REGION: 'ap-south-1',
    S3_ENDPOINT: '',
    S3_PUBLIC_ENDPOINT: '',
    S3_FORCE_PATH_STYLE: 'false',
    S3_ACCESS_KEY: 'AKIATESTEXAMPLE',
    S3_SECRET_KEY: 'test-only-secret',
  });
  assert.equal(config.s3Bucket, 'michat-main-bucket');
  assert.equal(config.s3Region, 'ap-south-1');
  assert.equal(config.s3Endpoint, '');
  assert.equal(config.s3ForcePathStyle, false);
  const summary = JSON.stringify(publicSmokeSummary(config));
  assert.equal(summary.includes('AKIATESTEXAMPLE'), false);
  assert.equal(summary.includes('test-only-secret'), false);
  assert.match(summary, /"credentials":"set"/);
  assert.match(summary, /"endpoint":"aws-regional"/);
});

test('read-only mode only sends HeadBucket', async () => {
  const mock = mockSend();
  const report = await runS3SmokeTest({
    send: mock.send,
    bucket: 'michat-main-bucket',
    allowWrite: false,
    key: `${SMOKE_PREFIX}readonly.bin`,
  });
  assert.equal(report.mode, 'read-only');
  assert.equal(report.headBucket, 'ok');
  assert.equal(report.write, 'skipped');
  assert.deepEqual(
    mock.commands.map((item) => item.name),
    ['HeadBucketCommand'],
  );
  assert.equal(mock.commands[0].bucket, 'michat-main-bucket');
});

test('write mode puts, gets, verifies, and deletes only the smoke object', async () => {
  const key = `${SMOKE_PREFIX}write-ok.bin`;
  const mock = mockSend();
  const report = await runS3SmokeTest({
    send: mock.send,
    bucket: 'michat-main-bucket',
    allowWrite: true,
    key,
    body: payload,
  });
  assert.equal(report.mode, 'write');
  assert.equal(report.headBucket, 'ok');
  assert.equal(report.putObject, 'ok');
  assert.equal(report.getObject, 'ok');
  assert.equal(report.contentMatch, true);
  assert.equal(report.deleteObject, 'ok');
  assert.equal(report.write, 'ok');
  assert.deepEqual(
    mock.commands.map((item) => item.name),
    ['HeadBucketCommand', 'PutObjectCommand', 'GetObjectCommand', 'DeleteObjectCommand'],
  );
  assert.equal(
    mock.commands.every((item) => !item.key || item.key === key),
    true,
  );
  assert.equal(mock.commands.find((item) => item.name === 'PutObjectCommand').encryption, 'AES256');
});

test('cleanup still deletes the smoke object when verification fails', async () => {
  const key = `${SMOKE_PREFIX}mismatch.bin`;
  const mock = mockSend({ getBody: Buffer.from('different') });
  const report = await runS3SmokeTest({
    send: mock.send,
    bucket: 'michat-main-bucket',
    allowWrite: true,
    key,
    body: payload,
  });
  assert.equal(report.contentMatch, false);
  assert.equal(report.write, 'mismatch');
  assert.equal(report.deleteObject, 'ok');
  assert.equal(mock.commands.at(-1).name, 'DeleteObjectCommand');
  assert.equal(mock.commands.at(-1).key, key);
});

test('cleanup still deletes after a failed GetObject', async () => {
  const key = `${SMOKE_PREFIX}get-fail.bin`;
  const mock = mockSend({ failGet: true });
  const report = await runS3SmokeTest({
    send: mock.send,
    bucket: 'michat-main-bucket',
    allowWrite: true,
    key,
    body: payload,
  });
  assert.equal(report.putObject, 'ok');
  assert.equal(report.write, 'NoSuchKey');
  assert.equal(report.deleteObject, 'ok');
  assert.equal(mock.commands.map((item) => item.name).includes('DeleteObjectCommand'), true);
});

test('refuses keys outside the smoke prefix before sending', async () => {
  const mock = mockSend();
  await assert.rejects(
    () =>
      runS3SmokeTest({
        send: mock.send,
        bucket: 'michat-main-bucket',
        allowWrite: true,
        key: 'att/production.bin',
      }),
    /michat-smoke-test/,
  );
  assert.equal(mock.commands.length, 0);
});

test('write mode never lists objects or mutates bucket configuration', async () => {
  const mock = mockSend();
  await runS3SmokeTest({
    send: mock.send,
    bucket: 'michat-main-bucket',
    allowWrite: true,
    key: `${SMOKE_PREFIX}no-list.bin`,
    body: payload,
  });
  const names = mock.commands.map((item) => item.name);
  assert.equal(
    names.every((name) => ['HeadBucketCommand', 'PutObjectCommand', 'GetObjectCommand', 'DeleteObjectCommand'].includes(name)),
    true,
  );
  assert.equal(names.some((name) => /List|Cors|Lifecycle|CreateBucket|DeleteBucket|CopyObject/.test(name)), false);
});

test('CLI skips AWS when credentials are missing and write mode still uses HeadBucket first', async () => {
  const missing = await main([], { S3_BUCKET: 'michat-main-bucket', S3_REGION: 'ap-south-1' }, () => {
    throw new Error('client should not be created');
  });
  assert.equal(missing, 2);

  const commands = [];
  const code = await main(
    ['--allow-write'],
    {
      S3_BUCKET: 'michat-main-bucket',
      S3_REGION: 'ap-south-1',
      S3_ACCESS_KEY: 'AKIATESTEXAMPLE',
      S3_SECRET_KEY: 'test-only-secret',
      S3_FORCE_PATH_STYLE: 'false',
    },
    () => ({
      send: async (command) => {
        commands.push(command.constructor.name);
        if (command.constructor.name === 'GetObjectCommand') {
          return { Body: Buffer.from('michat-smoke-test') };
        }
        return {};
      },
    }),
  );
  assert.equal(code, 0);
  assert.deepEqual(commands, [
    'HeadBucketCommand',
    'PutObjectCommand',
    'GetObjectCommand',
    'DeleteObjectCommand',
  ]);
});

test('write mode records HeadBucket before any object mutation', async () => {
  const mock = mockSend({ failPut: true });
  const report = await runS3SmokeTest({
    send: mock.send,
    bucket: 'michat-main-bucket',
    allowWrite: true,
    key: `${SMOKE_PREFIX}put-fail.bin`,
    body: payload,
  });
  assert.equal(mock.commands[0].name, 'HeadBucketCommand');
  assert.equal(report.putObject, undefined);
  assert.equal(report.write, 'AccessDenied');
  assert.equal(report.deleteObject, 'ok');
});
