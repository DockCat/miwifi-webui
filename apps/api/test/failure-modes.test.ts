/**
 * Failure-mode tests (Task 0008).
 *
 * The API must degrade safely when the database is unreachable: health
 * stays 200 (process alive), ready reports database:false without leaking
 * connection details, and auth-protected endpoints fail closed (401).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

// A pool pointed at a closed port — connections refused instantly.
const DEAD_PORT = 59999;

let app: FastifyInstance;

before(async () => {
  const deadPool = new pg.Pool({
    connectionString: `postgres://nobody:nobody@127.0.0.1:${DEAD_PORT}/nowhere`,
    connectionTimeoutMillis: 250,
    max: 1
  });
  app = await buildApp({ pool: deadPool });
  await app.ready();
});

after(async () => {
  await app?.close();
});

describe('API with unreachable database', () => {
  it('health stays 200 (process-level liveness)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'ok');
  });

  it('ready reports unavailable with boolean-only detail and no leak', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/ready' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.deepEqual(body, { status: 'unavailable', checks: { database: false } });
    assert.ok(!response.body.includes(String(DEAD_PORT)), 'no connection detail leaked');
    assert.ok(!response.body.includes('nobody'), 'no credential leaked');
    assert.ok(!response.body.includes('ECONNREFUSED'), 'no error text leaked');
  });

  it('protected endpoints fail closed (401, not a crash)', async () => {
    const devices = await app.inject({
      method: 'GET',
      url: '/api/routers/00000000-0000-0000-0000-000000000000/devices'
    });
    assert.equal(devices.statusCode, 401);
  });

  it('bootstrap against a dead DB returns a safe error, not a stack trace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'admin', password: 'Valid-Pass-123' })
    });
    // It may 500 (db down) — but the body must be a clean JSON error.
    assert.ok([409, 500, 503].includes(response.statusCode));
    const body = JSON.parse(response.body) as { error?: string };
    assert.ok(typeof body.error === 'string');
    assert.ok(!response.body.includes('at '), 'no stack trace leaked');
    assert.ok(!response.body.includes('postgres://'), 'no connection string leaked');
    assert.ok(
      !response.body.includes(String(DEAD_PORT)),
      'no connection detail leaked'
    );
  });
});
