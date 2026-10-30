import { loadEnv } from '../../config/env.js';
import { createDatabase } from '../index.js';
import { bootstrapAdmin } from './admin.seed.js';

const config = loadEnv();
const database = createDatabase(config);
try {
  const result = await bootstrapAdmin(database.db, {
    username: process.env.BOOTSTRAP_ADMIN_USERNAME,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    displayName: process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME,
  });
  process.stdout.write(
    result.created
      ? 'Initial administrator created.\n'
      : 'Administrator already exists; no changes made.\n',
  );
} finally {
  await database.close();
}
