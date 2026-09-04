/**
 * Fastify application factory.
 *
 * Kept separate from main.ts so tests can build the app without binding a
 * port or owning the database lifecycle. Async because plugin registration
 * (@fastify/cookie) must complete before routes are registered.
 */
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { AuthRepository } from './auth/repository.js';
import { AuditWriter } from './audit/writer.js';
import { RouterRepository } from './router/repository.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerRouterRoutes } from './routes/router.js';
import type pg from 'pg';

export async function buildApp(pool: pg.Pool): Promise<FastifyInstance> {
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

  registerHealthRoutes(app, pool);
  registerAuthRoutes(app, { repository: authRepository, audit });
  registerRouterRoutes(app, { repository: routerRepository, audit });

  return app;
}
