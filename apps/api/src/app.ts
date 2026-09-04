/**
 * Fastify application factory.
 *
 * Kept separate from main.ts so tests can build the app without binding a
 * port or owning the database lifecycle.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoutes } from './routes/health.js';
import type pg from 'pg';

export function buildApp(pool: pg.Pool): FastifyInstance {
  const app = Fastify({
    // Structured pino logging with safe base fields. Request bodies are
    // never logged globally.
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      base: { service: 'miwifi-webui-api' }
    }
  });

  registerHealthRoutes(app, pool);

  return app;
}
