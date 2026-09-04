/**
 * API entrypoint: structured startup, graceful shutdown.
 */
import process from 'node:process';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closePool, createPool } from './db/pool.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const pool = createPool(config.databaseUrl);
  const app = buildApp(pool);

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error(error, 'Failed to start API');
    await closePool(pool);
    process.exitCode = 1;
    return;
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down');
    try {
      await app.close(); // Closes the HTTP server; in-flight requests drain.
      await closePool(pool);
      app.log.info('Shutdown complete');
    } catch (error) {
      app.log.error(error, 'Error during shutdown');
      process.exitCode = 1;
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
