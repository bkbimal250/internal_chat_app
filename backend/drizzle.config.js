import { loadEnvFile } from 'node:process';
import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './src/config/env.js';

try {
  loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const config = loadEnv();
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.js',
  out: './src/database/migrations',
  dbCredentials: { url: config.databaseUrl },
  strict: true,
  verbose: false,
});
