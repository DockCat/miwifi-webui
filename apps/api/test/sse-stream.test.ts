import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import { EventBridge } from '../src/observability/event-bridge.js';
import { SESSION_COOKIE } from '../src/auth/plugin.js';

function poolWithValidSession(): pg.Pool {
  return {
    query: async (sql: string) => {
      if (sql.includes('FROM app_session')) {
        return { rows: [{
          id: 'session-1', userId: 'user-1', tokenHash: 'redacted',
          createdAt: new Date(), lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + 3600_000)
        }] };
      }
      if (sql.includes('FROM app_user')) {
        return { rows: [{
          id: 'user-1', username: 'admin', role: 'admin',
          createdAt: new Date(), passwordHash: 'not-needed'
        }] };
      }
      return { rows: [] };
    }
  } as unknown as pg.Pool;
}

describe('SSE response ownership and lifetime', () => {
  it('rejects unauthenticated connections without opening an event stream', async () => {
    const app = await buildApp({ pool: poolWithValidSession() });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/events' });
      assert.equal(response.statusCode, 401);
    } finally {
      await app.close();
    }
  });

  it('streams events and replay without Fastify auto-sending a second response', async () => {
    const events = new EventBridge();
    const app = await buildApp({ pool: poolWithValidSession(), eventBridge: events });
    const controller = new AbortController();
    try {
      const address = await app.listen({ port: 0, host: '127.0.0.1' });
      const response = await fetch(address + '/api/events', {
        headers: { cookie: SESSION_COOKIE + '=test-token' },
        signal: controller.signal
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
      const reader = response.body!.getReader();
      const handshake = await reader.read();
      assert.equal(handshake.done, false);
      assert.match(new TextDecoder().decode(handshake.value), /: connected/);
      const published = events.publish('router-status', { routerId: 'router-1', status: { online: true } });
      let text = '';
      for (let i = 0; i < 12 && !text.includes('\n\n'); i++) {
        const frame = await reader.read();
        assert.equal(frame.done, false);
        text += new TextDecoder().decode(frame.value);
      }
      assert.match(text, /event: router-status/);
      assert.match(text, new RegExp('id: ' + published.id));
      assert.match(text, /"online":true/);
    } finally {
      controller.abort();
      await app.close();
    }
  });
});
