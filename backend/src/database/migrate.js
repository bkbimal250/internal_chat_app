import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { createDatabase } from './index.js';

export const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function applyMigrations(config = loadEnv()) {
  const logger = createLogger({ nodeEnv: config.nodeEnv, logLevel: config.logLevel });
  const database = createDatabase(config, logger);
  try {
    await database.check();
    await migrate(database.db, { migrationsFolder });
    logger.info({ folder: migrationsFolder }, 'Database migrations applied');
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyMigrations().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
