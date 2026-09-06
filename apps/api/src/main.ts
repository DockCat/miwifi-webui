/**
 * API entrypoint: structured startup, graceful shutdown.
 */
import process from 'node:process';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closePool, createPool } from './db/pool.js';
import { applyMigrations } from './db/migrate.js';
import { parseMasterKey } from './crypto/envelope.js';
import { RouterRepository } from './router/repository.js';
import { ObservabilityRepository } from './observability/repository.js';
import { EventBridge } from './observability/event-bridge.js';
import { PollingScheduler } from './observability/scheduler.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const pool = createPool(config.databaseUrl);

  // Automatically apply database migrations on startup.
  try {
    const applied = await applyMigrations(pool);
    if (applied.length > 0) {
      console.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
    }
  } catch (error) {
    console.error('Failed to run database migrations:', error);
    await closePool(pool);
    process.exitCode = 1;
    return;
  }

  // Master key is required for router credential renewal; without it the
  // scheduler cannot run but the app still serves (auth health etc.).
  const eventBridge = new EventBridge();
  let scheduler: PollingScheduler | null = null;
  let masterKeyWarning = false;
  try {
    const masterKey = parseMasterKey(process.env.APP_MASTER_KEY);
    scheduler = new PollingScheduler(
      pool,
      new RouterRepository(pool),
      new ObservabilityRepository(pool),
      eventBridge,
      masterKey.toString('base64')
    );
    await scheduler.start();
  } catch {
    masterKeyWarning = true;
  }

  const app = await buildApp({
    pool,
    scheduler: scheduler ?? undefined,
    eventBridge,
    // TRUST_PROXY=true when the API runs behind the compose web proxy (or
    // another trusted reverse proxy), so request.protocol / request.ip use
    // the forwarded headers instead of the proxy's own address.
    trustProxy: config.trustProxy
  });

  if (masterKeyWarning) {
    app.log.warn('APP_MASTER_KEY not configured; router polling disabled');
  }

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error(error, 'Failed to start API');
    scheduler?.stop();
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
      scheduler?.stop();
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
