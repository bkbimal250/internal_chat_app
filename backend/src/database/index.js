import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { poolOptions } from '../config/database.js';
import * as schema from './schema/index.js';

export function createDatabase(config, logger) {
  const pool = new pg.Pool(poolOptions(config));
  pool.on('error', () => logger?.error({ code: 'DATABASE_POOL_ERROR' }, 'Database pool error'));
  const db = drizzle(pool, { schema });
  let closePromise;
  return {
    db,
    pool,
    async check() {
      await pool.query('SELECT 1');
    },
    close() {
      closePromise ??= pool.end();
      return closePromise;
    },
  };
}
