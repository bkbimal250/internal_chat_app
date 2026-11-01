import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pino from 'pino';
import { loadEnv } from '../config/env.js';
import { createDatabase } from '../database/index.js';
import { loggerOptions } from '../utils/logger.js';
import { objectStorage } from '../services/object-storage.service.js';
import { retentionService } from '../modules/retention/retention.service.js';
import { pushService } from '../services/push.service.js';

const LOCK = 739001;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

export async function runRetentionWorker({ config = loadEnv(), once = false } = {}) {
  const log = pino(loggerOptions(config));
  const database = createDatabase(config, log);
  const storage = objectStorage(config, log);
  const app = {
    database,
    storage,
    log,
    push: null,
    broadcaster: {
      conversation: async (id, event, data) => {
        await database.pool.query('select pg_notify($1, $2)', [
          'retention',
          JSON.stringify({ event, conversationId: id, data }),
        ]);
      },
      user: async (id, event, data) => {
        await database.pool.query('select pg_notify($1, $2)', [
          'retention',
          JSON.stringify({ event, userId: id, data }),
        ]);
      },
    },
  };
  app.push = pushService(app, config);
  const service = retentionService(app, config);
  const interval = config.retentionWorkerIntervalMs;
  const health = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', service: 'retention-worker', mode: 'preview-until-approved' }));
  });
  await new Promise((resolve) => health.listen(3002, '127.0.0.1', resolve));
  log.info({ interval }, 'Retention worker started (preview until admin approval)');

  const tick = async () => {
    const locked = await database.pool.query('select pg_try_advisory_lock($1) as ok', [LOCK]);
    if (!locked.rows[0]?.ok) {
      log.info('Retention worker skipped; another worker holds the lock');
      return { skipped: 'locked' };
    }
    try {
      const result = await service.cycle();
      log.info({ result }, 'Retention cycle finished');
      return result;
    } finally {
      await database.pool.query('select pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    }
  };

  if (once) {
    const result = await tick();
    await new Promise((resolve) => health.close(resolve));
    await database.close();
    return result;
  }

  let stopped = false;
  const stop = async () => {
    stopped = true;
    await new Promise((resolve) => health.close(resolve));
    await database.close();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  while (!stopped) {
    try {
      await tick();
    } catch (error) {
      log.error({ err: error }, 'Retention cycle failed');
    }
    if (!stopped) await sleep(interval);
  }
}

if (isDirectRun()) {
  runRetentionWorker().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
