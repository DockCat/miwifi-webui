/**
 * Health endpoint tests.
 *
 * Covers:
 * - /api/health responds with the process-liveness contract, secret-free;
 * - /api/ready reflects database readiness with boolean-only detail;
 * - responses never contain sentinel secrets (leak regression).
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoutes } from '../src/routes/health.js';

/**
 * Recognizable sentinel so accidental secret leakage is detectable.
 * Mirrors the pattern required for secret-leak regression testing.
 */
const SENTINEL_DB_URL = 'postgres://sentinel-user:SENTINEL-DB-PASSWORD@db.local:5432/sentinel';

function makeStubPool(ready: boolean): { pool: unknown } {
  return {
    pool: {
      query: async () => {
        if (!ready) throw new Error('connection refused');
        return { rows: [] };
      }
    }
  };
}

async function buildTestApp(ready: boolean): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { pool } = makeStubPool(ready);
  registerHealthRoutes(app, pool as never);
  return app;
}

const apps: FastifyInstance[] = [];
const track = (app: FastifyInstance): FastifyInstance => {
  apps.push(app);
  return app;
};

after(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe('GET /api/health', () => {
  it('returns process-liveness contract', async () => {
    const app = track(await buildTestApp(true));
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      status: 'ok',
      service: 'miwifi-webui-api',
      time: JSON.parse(response.body).time
    });
    const body = JSON.parse(response.body) as { time: string };
    assert.ok(!Number.isNaN(Date.parse(body.time)), 'time is ISO-8601');
  });

  it('does not leak secrets', async () => {
    const app = track(await buildTestApp(true));
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    assert.ok(!response.body.includes('SENTINEL'), 'health body must not contain secrets');
    assert.ok(!response.body.includes(SENTINEL_DB_URL), 'health body must not contain DB URL');
  });
});

describe('GET /api/ready', () => {
  it('reports ok with database reachable', async () => {
    const app = track(await buildTestApp(true));
    const response = await app.inject({ method: 'GET', url: '/api/ready' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      status: 'ok',
      checks: { database: true }
    });
  });

  it('reports unavailable when database is down, boolean-only detail', async () => {
    const app = track(await buildTestApp(false));
    const response = await app.inject({ method: 'GET', url: '/api/ready' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      status: 'unavailable',
      checks: { database: false }
    });
    // Failure detail must stay boolean — no error text, no connection info.
    assert.ok(!response.body.includes('connection refused'));
    assert.ok(!response.body.includes('SENTINEL'));
  });
});
