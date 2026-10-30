import { pathToFileURL } from 'node:url';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './utils/logger.js';

export async function startServer(config = loadEnv()) {
  const app = await buildApp({ config });
  try {
    await app.database.check();
    await app.listen({ host: config.host, port: config.port });
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function main() {
  const logger = createLogger({ nodeEnv: process.env.NODE_ENV ?? 'development', logLevel: 'info' });
  let app;
  let stopping = false;
  let shutdownTimeoutMs = 10000;
  const shutdown = async (signal, failed = false) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Shutting down');
    const timer = setTimeout(() => process.exit(1), shutdownTimeoutMs);
    timer.unref();
    try {
      await app?.close();
      process.exitCode = failed ? 1 : 0;
    } catch {
      logger.error({ code: 'SHUTDOWN_FAILED' }, 'Shutdown failed');
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const config = loadEnv();
    shutdownTimeoutMs = config.shutdownTimeoutMs;
    app = await startServer(config);
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('uncaughtException', () => void shutdown('uncaughtException', true));
    process.once('unhandledRejection', () => void shutdown('unhandledRejection', true));
  } catch {
    logger.fatal(
      { code: 'STARTUP_FAILED' },
      'Startup failed; check environment and database availability',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
