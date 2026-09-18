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
import rateLimit from '@fastify/rate-limit';
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
import { registerMutationRoutes } from './routes/mutations.js';
import { registerInvestigationRoutes } from './routes/investigations.js';
import { InvestigationRepository } from './ai/repository.js';
import { registerSpeedtestRoutes } from './routes/speedtest.js';
import { SpeedtestRepository } from './speedtest/repository.js';
import { SpeedtestService } from './speedtest/service.js';
import { loadSpeedtestConfig } from './speedtest/config.js';
import type pg from 'pg';

export interface BuildAppOptions {
  readonly pool: pg.Pool;
  /** Created by main.ts; absent in tests unless a test provides one. */
  readonly scheduler?: PollingScheduler;
  readonly eventBridge?: EventBridge;
  readonly speedtestService?: SpeedtestService;
  /**
   * Trust X-Forwarded-* headers (request.ip, protocol). Boolean `true`
   * trusts every forwarded claim — only safe when no untrusted client can
   * reach the port. A comma-separated proxy IP/CIDR string (e.g.
   * "192.168.155.0/24") trusts only those peers as proxies, so request.ip
   * resolves to the first hop beyond them and client-supplied entries are
   * ignored. Default false (standalone / direct access).
   */
  readonly trustProxy?: boolean | string;
}

export async function buildApp(
  options: BuildAppOptions | pg.Pool
): Promise<FastifyInstance> {
  const { pool, scheduler, eventBridge, trustProxy } =
    ('query' in options && typeof options.query === 'function')
      ? { pool: options, scheduler: undefined, eventBridge: undefined, trustProxy: undefined }
      : (options as BuildAppOptions);

  const app = Fastify({
    // Structured pino logging with safe base fields. Request bodies are
    // never logged globally.
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      base: { service: 'miwifi-webui-api' }
    },
    // Only honor X-Forwarded-* when explicitly configured for a trusted
    // proxy deployment; spoofing the header must not work by default.
    trustProxy: trustProxy ?? false
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 1000,
    timeWindow: '1 minute'
  });

  // Global error handler: unhandled failures return a clean JSON error —
  // never connection strings, stack traces, or driver messages (which can
  // embed DB host:port).
  app.setErrorHandler((error: unknown, _request, reply) => {
    const err = error as { name?: string; message?: string; statusCode?: number };
    app.log.error(
      { err: { name: err.name, message: err.message } },
      'unhandled request error'
    );
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return reply.code(status).send({ error: 'internal' });
  });

  // Baseline security response headers on every API response. The browser
  // UI is served separately (nginx); these cover direct API access.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    // The API serves JSON only; default-src 'none' + frame-ancestors close
    // embedding and plugin content entirely.
    reply.header(
      'content-security-policy',
      "default-src 'none'; frame-ancestors 'none'"
    );
  });

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
  registerMutationRoutes(app, {
    routerRepository,
    observabilityRepository,
    audit
  });
  registerInvestigationRoutes(app, {
    repository: new InvestigationRepository(pool),
    audit,
    pool,
    scheduler
  });

  const speedtestConfig = loadSpeedtestConfig();
  const speedtest =
    options && typeof options === 'object' && 'speedtestService' in options && options.speedtestService
      ? options.speedtestService
      : new SpeedtestService({
          repository: new SpeedtestRepository(pool),
          events,
          getRouterAdapter: (routerId) => {
            return routerId ? scheduler?.getAdapter(routerId) ?? null : null;
          },
          downloadBytes: speedtestConfig.downloadBytes,
          uploadBytes: speedtestConfig.uploadBytes,
          mlabDurationSeconds: speedtestConfig.mlabDurationSeconds
        });

  registerSpeedtestRoutes(app, { speedtestService: speedtest });

  return app;
}
