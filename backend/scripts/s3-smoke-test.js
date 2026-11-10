import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createS3ClientOptions } from '../src/services/object-storage.service.js';

export const SMOKE_PREFIX = 'michat-smoke-test/';
const ALLOWED_COMMANDS = new Set([
  'HeadBucketCommand',
  'PutObjectCommand',
  'GetObjectCommand',
  'DeleteObjectCommand',
]);

export function awsConfigFromEnv(env = process.env) {
  const endpoint = String(env.S3_ENDPOINT ?? '').trim();
  return {
    s3Endpoint: endpoint,
    s3PublicEndpoint: String(env.S3_PUBLIC_ENDPOINT ?? '').trim() || endpoint,
    s3Region: String(env.S3_REGION ?? 'ap-south-1').trim() || 'ap-south-1',
    s3Bucket: String(env.S3_BUCKET ?? '').trim(),
    s3AccessKey: env.S3_ACCESS_KEY || env.AWS_ACCESS_KEY_ID || '',
    s3SecretKey: env.S3_SECRET_KEY || env.AWS_SECRET_ACCESS_KEY || '',
    s3ForcePathStyle:
      env.S3_FORCE_PATH_STYLE === 'false' || env.S3_FORCE_PATH_STYLE === '0'
        ? false
        : env.S3_FORCE_PATH_STYLE === 'true' || env.S3_FORCE_PATH_STYLE === '1'
          ? true
          : Boolean(endpoint),
  };
}

export function parseSmokeArgs(argv) {
  let allowWrite = false;
  for (const arg of argv) {
    if (arg === '--allow-write') allowWrite = true;
    else if (arg === '--help' || arg === '-h') return { help: true, allowWrite: false };
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { help: false, allowWrite };
}

export function createSmokeKey(now = new Date(), entropy = randomBytes(16)) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${SMOKE_PREFIX}obj-${stamp}-${entropy.toString('hex')}.bin`;
}

export function assertAllowedSmokeKey(key) {
  if (typeof key !== 'string' || !key.startsWith(SMOKE_PREFIX)) {
    throw new Error('Refusing to operate on a key outside michat-smoke-test/');
  }
  const rest = key.slice(SMOKE_PREFIX.length);
  if (!rest || rest.includes('/') || rest.includes('\\') || rest.includes('..') || key.length > 180) {
    throw new Error('Refusing to operate on a key outside michat-smoke-test/');
  }
}

export function publicSmokeSummary(config) {
  return {
    bucket: config.s3Bucket || '<missing>',
    region: config.s3Region,
    endpoint: config.s3Endpoint ? 'custom' : 'aws-regional',
    pathStyle: config.s3ForcePathStyle === true,
    credentials: config.s3AccessKey && config.s3SecretKey ? 'set' : 'missing',
  };
}

export async function readBody(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function commandName(command) {
  return command?.constructor?.name || '';
}

async function guardedSend(send, bucket, command) {
  const name = commandName(command);
  if (!ALLOWED_COMMANDS.has(name)) {
    throw new Error('Refusing unsupported S3 command');
  }
  const targetBucket = command.input?.Bucket;
  if (targetBucket && targetBucket !== bucket) {
    throw new Error('Refusing to target a different bucket');
  }
  if (Object.hasOwn(command.input || {}, 'Key')) {
    assertAllowedSmokeKey(command.input.Key);
  }
  return send(command);
}

export async function runS3SmokeTest({
  send,
  bucket,
  allowWrite = false,
  key = createSmokeKey(),
  body = Buffer.from('michat-smoke-test'),
} = {}) {
  if (!bucket) throw new Error('S3_BUCKET is required');
  assertAllowedSmokeKey(key);
  const report = {
    mode: allowWrite ? 'write' : 'read-only',
    bucket,
    prefix: SMOKE_PREFIX,
    headBucket: 'pending',
    write: allowWrite ? 'pending' : 'skipped',
  };
  const call = (command) => guardedSend(send, bucket, command);

  await call(new HeadBucketCommand({ Bucket: bucket }));
  report.headBucket = 'ok';
  if (!allowWrite) return report;

  report.objectKey = key;
  let putAttempted = false;
  try {
    putAttempted = true;
    await call(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'application/octet-stream',
        ServerSideEncryption: 'AES256',
      }),
    );
    report.putObject = 'ok';
    const downloaded = await readBody((await call(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body);
    report.getObject = 'ok';
    report.contentMatch = Buffer.compare(downloaded, body) === 0;
    report.write = report.contentMatch ? 'ok' : 'mismatch';
  } catch (error) {
    report.write = error.name || 'error';
  } finally {
    if (putAttempted) {
      assertAllowedSmokeKey(key);
      try {
        await call(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        report.deleteObject = 'ok';
      } catch (error) {
        report.deleteObject = error.name || 'error';
        if (report.write === 'ok') report.write = 'cleanup-failed';
      }
    }
  }
  return report;
}

export function usage() {
  return [
    'MiChat S3 smoke test (HeadBucket by default; writes require --allow-write).',
    '',
    'Read-only:',
    '  S3_BUCKET=michat-main-bucket S3_REGION=ap-south-1 node scripts/s3-smoke-test.js',
    '',
    'Write (Put/Get/Delete one object under michat-smoke-test/ only):',
    '  S3_BUCKET=michat-main-bucket S3_REGION=ap-south-1 node scripts/s3-smoke-test.js --allow-write',
    '',
    'Required env: S3_BUCKET, S3_ACCESS_KEY or AWS_ACCESS_KEY_ID, S3_SECRET_KEY or AWS_SECRET_ACCESS_KEY.',
    'Optional: S3_REGION (default ap-south-1), S3_ENDPOINT, S3_PUBLIC_ENDPOINT, S3_FORCE_PATH_STYLE.',
    'Never prints credentials, signed URLs, or object bytes.',
  ].join('\n');
}

function printReport(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export async function main(argv = process.argv.slice(2), env = process.env, createClient = (options) => new S3Client(options)) {
  const args = parseSmokeArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const config = awsConfigFromEnv(env);
  const summary = publicSmokeSummary(config);
  if (summary.credentials === 'missing' || summary.bucket === '<missing>') {
    process.stderr.write('S3_BUCKET and access credentials are required.\n');
    printReport({ ...summary, headBucket: 'skipped', write: 'skipped' });
    return 2;
  }
  try {
    const client = createClient(createS3ClientOptions(config));
    const report = await runS3SmokeTest({
      send: (command) => client.send(command),
      bucket: config.s3Bucket,
      allowWrite: args.allowWrite,
    });
    printReport({ ...summary, ...report });
    return report.headBucket === 'ok' && (!args.allowWrite || (report.write === 'ok' && report.deleteObject === 'ok'))
      ? 0
      : 1;
  } catch {
    printReport({ ...summary, headBucket: 'error', write: 'skipped' });
    return 1;
  }
}

const invokedAsCli =
  Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedAsCli) {
  main().then(
    (code) => process.exit(code),
    () => {
      process.stderr.write('Error: smoke test failed\n');
      process.exit(1);
    },
  );
}
