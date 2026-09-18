import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth/plugin.js';
import { SpeedtestService } from '../src/speedtest/service.js';
import { EventBridge } from '../src/observability/event-bridge.js';
import type { SpeedtestResultDTO } from '@miwifi-webui/contracts';

function createMockPool(): pg.Pool {
  const mockPool = {
    query: async (text: string) => {
      if (text.includes('FROM app_session')) {
        return {
          rows: [
            {
              id: 'sess-1',
              userId: 'user-1',
              tokenHash: 'dummy',
              createdAt: new Date(),
              lastSeenAt: new Date(),
              expiresAt: new Date(Date.now() + 3600_000)
            }
          ]
        };
      }
      if (text.includes('FROM app_user')) {
        return {
          rows: [
            {
              id: 'user-1',
              username: 'admin',
              passwordHash: 'dummy',
              role: 'admin',
              createdAt: new Date()
            }
          ]
        };
      }
      if (text.includes('UPDATE app_session')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  } as unknown as pg.Pool;
  return mockPool;
}

describe('Seam 3: Speedtest Routes', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const app = await buildApp({ pool: createMockPool() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/speedtest/run',
      payload: { provider: 'cloudflare' }
    });
    assert.equal(res.statusCode, 401);
  });

  it('triggers speedtest successfully when authenticated', async () => {
    const pool = createMockPool();
    const events = new EventBridge();
    const mockResult: SpeedtestResultDTO = {
      id: 'st-1',
      downloadBps: 100_000_000,
      uploadBps: 20_000_000,
      pingMs: 15,
      jitterMs: 2,
      provider: 'cloudflare',
      source: 'backend',
      triggeredBy: 'manual',
      status: 'completed',
      createdAt: new Date().toISOString()
    };

    const mockRepo = {
      insertResult: async () => mockResult,
      getLatest: async () => mockResult,
      getHistory: async () => [mockResult],
      purgeOlderThan: async () => 0
    };

    const speedtestService = new SpeedtestService({
      repository: mockRepo as never,
      events,
      createProvider: () => ({
        name: 'cloudflare',
        run: async () => ({
          downloadBps: 100_000_000,
          uploadBps: 20_000_000,
          pingMs: 15,
          jitterMs: 2,
          provider: 'cloudflare',
          source: 'backend',
          status: 'completed'
        })
      })
    });

    const app = await buildApp({
      pool,
      eventBridge: events,
      speedtestService
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/speedtest/run',
      headers: {
        cookie: `${SESSION_COOKIE}=valid-session-token`
      },
      payload: { provider: 'cloudflare' }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { result: SpeedtestResultDTO };
    assert.equal(body.result.downloadBps, 100_000_000);
  });

  it('returns 409 conflict when a speedtest is already in progress', async () => {
    const pool = createMockPool();
    const events = new EventBridge();

    const mockRepo = {
      insertResult: async () => ({} as never),
      getLatest: async () => null,
      getHistory: async () => [],
      purgeOlderThan: async () => 0
    };

    const speedtestService = new SpeedtestService({
      repository: mockRepo as never,
      events,
      createProvider: () => ({
        name: 'cloudflare',
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return {
            downloadBps: 50_000_000,
            uploadBps: 10_000_000,
            pingMs: 20,
            jitterMs: 1,
            provider: 'cloudflare',
            source: 'backend',
            status: 'completed'
          };
        }
      })
    });

    const app = await buildApp({
      pool,
      eventBridge: events,
      speedtestService
    });

    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/speedtest/run',
        headers: { cookie: `${SESSION_COOKIE}=valid-session-token` }
      }),
      app.inject({
        method: 'POST',
        url: '/api/speedtest/run',
        headers: { cookie: `${SESSION_COOKIE}=valid-session-token` }
      })
    ]);

    const statusCodes = [resA.statusCode, resB.statusCode].sort();
    assert.deepEqual(statusCodes, [200, 409]);
  });

  it('gets latest and history results when authenticated', async () => {
    const pool = createMockPool();
    const mockResult: SpeedtestResultDTO = {
      id: 'st-1',
      downloadBps: 80_000_000,
      uploadBps: 15_000_000,
      pingMs: 12,
      jitterMs: 1,
      provider: 'auto',
      source: 'router',
      triggeredBy: 'scheduled',
      status: 'completed',
      createdAt: new Date().toISOString()
    };

    const mockRepo = {
      insertResult: async () => mockResult,
      getLatest: async () => mockResult,
      getHistory: async () => [mockResult],
      purgeOlderThan: async () => 0
    };

    const speedtestService = new SpeedtestService({
      repository: mockRepo as never,
      events: new EventBridge()
    });

    const app = await buildApp({
      pool,
      speedtestService
    });

    const latestRes = await app.inject({
      method: 'GET',
      url: '/api/speedtest/latest',
      headers: { cookie: `${SESSION_COOKIE}=valid-session-token` }
    });

    assert.equal(latestRes.statusCode, 200);
    const latestBody = JSON.parse(latestRes.body) as { latest: SpeedtestResultDTO };
    assert.equal(latestBody.latest.downloadBps, 80_000_000);

    const histRes = await app.inject({
      method: 'GET',
      url: '/api/speedtest/history?limit=5',
      headers: { cookie: `${SESSION_COOKIE}=valid-session-token` }
    });

    assert.equal(histRes.statusCode, 200);
    const histBody = JSON.parse(histRes.body) as { history: SpeedtestResultDTO[] };
    assert.equal(histBody.history.length, 1);
  });

  it('enforces route rate limits on rapid repeated run attempts', async () => {
    const pool = createMockPool();
    const testResult: SpeedtestResultDTO = {
      id: 'st-limit',
      downloadBps: 50_000_000,
      uploadBps: 10_000_000,
      pingMs: 20,
      jitterMs: 3,
      provider: 'cloudflare',
      source: 'backend',
      triggeredBy: 'manual',
      status: 'completed',
      createdAt: new Date().toISOString()
    };
    const mockRepo = {
      insertResult: async () => testResult,
      getLatest: async () => testResult,
      getHistory: async () => [testResult],
      purgeOlderThan: async () => 0
    };

    const speedtestService = new SpeedtestService({
      repository: mockRepo as never,
      events: new EventBridge(),
      createProvider: () => ({
        name: 'cloudflare',
        run: async () => ({
          downloadBps: 100_000_000,
          uploadBps: 20_000_000,
          pingMs: 15,
          jitterMs: 2,
          provider: 'cloudflare',
          source: 'backend',
          status: 'completed'
        })
      })
    });

    const app = await buildApp({
      pool,
      speedtestService
    });

    // 10 requests allowed
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/speedtest/run',
        headers: { cookie: `${SESSION_COOKIE}=valid-session-token` }
      });
    }

    // 11th request should be rate-limited with 429
    const limitedRes = await app.inject({
      method: 'POST',
      url: '/api/speedtest/run',
      headers: { cookie: `${SESSION_COOKIE}=valid-session-token` }
    });

    assert.equal(limitedRes.statusCode, 429);
  });
});
