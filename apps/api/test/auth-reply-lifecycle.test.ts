import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import type pg from 'pg';
import { buildApp } from '../src/app.js';

// All 14 guarded paths previously returned the value of reply.sent, a boolean.
// Fastify treats that value as a new response and logs FST_ERR_REP_ALREADY_SENT.
const unauthorizedRoutes: Array<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'POST', path: '/api/auth/logout' },
  { method: 'GET', path: '/api/auth/session' },
  { method: 'POST', path: '/api/auth/password' },
  { method: 'GET', path: '/api/routers' },
  { method: 'POST', path: '/api/routers/onboard' },
  { method: 'GET', path: '/api/routers/00000000-0000-0000-0000-000000000001/status' },
  { method: 'GET', path: '/api/routers/00000000-0000-0000-0000-000000000001/telemetry' },
  { method: 'POST', path: '/api/routers/00000000-0000-0000-0000-000000000001/devices/00000000-0000-0000-0000-000000000002/block' },
  { method: 'GET', path: '/api/investigations/sessions' },
  { method: 'GET', path: '/api/investigations/sessions/00000000-0000-0000-0000-000000000001' },
  { method: 'POST', path: '/api/investigations/sessions/00000000-0000-0000-0000-000000000001/close' },
  { method: 'GET', path: '/api/investigations' },
  { method: 'GET', path: '/api/investigations/00000000-0000-0000-0000-000000000001' },
  { method: 'POST', path: '/api/investigations' }
];

describe('unauthenticated Fastify replies', () => {
  it('returns one stable 401 JSON response on every affected route', async () => {
    const pool = { query: async () => { throw new Error('unauthorized should not call DB'); } } as unknown as pg.Pool;
    const app = await buildApp({ pool });
    try {
      for (const route of unauthorizedRoutes) {
        const result = await app.inject({ method: route.method, url: route.path });
        assert.equal(result.statusCode, 401, route.path + ': ' + result.body);
        assert.deepEqual(JSON.parse(result.body), { error: 'unauthenticated' }, route.path);
      }
    } finally {
      await app.close();
    }
  });

  it('does not allow boolean reply.sent to be returned by authorization guards', () => {
    const dir = new URL('../src/routes/', import.meta.url);
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.ts')) continue;
      const source = readFileSync(new URL(entry, dir), 'utf8');
      assert.ok(!source.includes('reply.sent as unknown as object'),
        entry + ' must return reply rather than reply.sent');
    }
  });
});
