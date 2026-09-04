/**
 * Fastify application factory.
 *
 * Kept separate from main.ts so tests can build the app without binding a
 * port or owning the database/polling lifecycle. Async because plugin
 * registration (@fastify/cookie) must complete before routes register.
 *
 * The polling scheduler is optional here: tests build apps without one;
 * main.ts creates it and passes it in.
 */
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { AuthRepository } from './auth/repository.js';
import { AuditWriter } from './audit/writer.js';
import { RouterRepository } from './router/repository.js';
import { ObservabilityRepository } from './observability/repository.js';
import { EventBridge } from './observability/event-bridge.js';
import type { PollingScheduler } from './observability/scheduler.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerRouterRoutes } from './routes/router.js';
import { registerObservabilityRoutes } from './routes/observability.js';
import type pg from 'pg';

export interface BuildAppOptions {
  readonly pool: pg.Pool;
  /** Created by main.ts; absent in tests unless a test provides one. */
  readonly scheduler?: PollingScheduler;
  readonly eventBridge?: EventBridge;
}

export async function buildApp(
  options: BuildAppOptions | pg.Pool
): Promise<FastifyInstance> {
  const { pool, scheduler, eventBridge } =
    ('query' in options && typeof options.query === 'function')
      ? { pool: options, scheduler: undefined, eventBridge: undefined }
      : (options as BuildAppOptions);

  const app = Fastify({
    // Structured pino logging with safe base fields. Request bodies are
    // never logged globally.
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      base: { service: 'miwifi-webui-api' }
    }
  });

  await app.register(cookie);

  const authRepository = new AuthRepository(pool);
  const audit = new AuditWriter(pool);
  const routerRepository = new RouterRepository(pool);
  const observabilityRepository = new ObservabilityRepository(pool);
  const events = eventBridge ?? new EventBridge();

  registerHealthRoutes(app, pool);
  registerAuthRoutes(app, { repository: authRepository, audit });
  registerRouterRoutes(app, { repository: routerRepository, audit });
  registerObservabilityRoutes(app, {
    repository: observabilityRepository,
    events,
    scheduler
  });

  return app;
}
