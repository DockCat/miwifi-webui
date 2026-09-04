/**
 * Health and readiness routes.
 *
 * /api/health  — process-level liveness. Safe, secret-free, unauthenticated.
 * /api/ready   — dependency readiness (database ping). Boolean-only detail.
 *
 * Neither route logs or returns environment values, credentials, or stack
 * traces.
 */
import type { FastifyInstance } from 'fastify';
import type { HealthResponse, ReadyResponse } from '@miwifi-webui/contracts';
import { checkDatabase } from '../db/pool.js';
import type pg from 'pg';

export function registerHealthRoutes(
  app: FastifyInstance,
  pool: pg.Pool
): void {
  app.get<{ Reply: HealthResponse }>('/api/health', async () => ({
    status: 'ok',
    service: 'miwifi-webui-api',
    time: new Date().toISOString()
  }));

  app.get<{ Reply: ReadyResponse }>('/api/ready', async () => {
    const db = await checkDatabase(pool);
    const ready = db.ok;
    return {
      status: ready ? 'ok' : 'unavailable',
      checks: { database: db.ok }
    };
  });
}
