/**
 * Observability route wiring and scheduler injection tests.
 *
 * Verifies that:
 * 1. When scheduler is missing, GET /api/routers/:id/status returns 503 (polling_not_running).
 * 2. When scheduler is present, GET /api/routers/:id/status returns the cached status.
 * 3. When scheduler is present, GET /api/routers/:id/devices enriches devices with live rates and totals.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth/plugin.js';
import type { PollingScheduler } from '../src/observability/scheduler.js';
import type { NormalizedDevice } from '@miwifi-webui/router-core';

function createMockPool(): pg.Pool {
  const mockPool = {
    query: async (text: string, params?: unknown[]) => {
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
      if (text.includes('FROM device')) {
        return {
          rows: [
            {
              id: 'dev-1',
              routerId: params?.[0] ?? 'router-1',
              mac: 'AA:BB:CC:DD:EE:01',
              name: 'my-phone',
              ip: '192.168.31.50',
              online: true,
              internetAccess: true,
              firstSeenAt: new Date(),
              lastSeenAt: new Date()
            }
          ]
        };
      }
      return { rows: [] };
    }
  };
  return mockPool as unknown as pg.Pool;
}

const AUTH_COOKIE = `${SESSION_COOKIE}=mock-token-xyz`;

describe('observability route wiring with scheduler', () => {
  it('returns 503 when scheduler is not configured', async () => {
    const pool = createMockPool();
    const app = await buildApp({ pool });
    await app.ready();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/routers/router-1/status',
        headers: { cookie: AUTH_COOKIE }
      });
      assert.equal(res.statusCode, 503);
      const body = JSON.parse(res.body);
      assert.equal(body.error, 'polling_not_running');
    } finally {
      await app.close();
    }
  });

  it('returns live status when scheduler is provided', async () => {
    const pool = createMockPool();
    const mockScheduler = {
      getStatus: (routerId: string) => {
        if (routerId === 'router-1') {
          return {
            capturedAt: '2026-09-05T20:00:00.000Z',
            cpuLoad: 12,
            memUsed: 64,
            wanUp: true,
            wanDownspeed: 524288,
            wanUpspeed: 131072
          };
        }
        return null;
      },
      getLatestDevices: () => null
    } as unknown as PollingScheduler;

    const app = await buildApp({ pool, scheduler: mockScheduler });
    await app.ready();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/routers/router-1/status',
        headers: { cookie: AUTH_COOKIE }
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.routerId, 'router-1');
      assert.equal(body.status.cpuLoad, 12);
      assert.equal(body.status.wanDownspeed, 524288);
    } finally {
      await app.close();
    }
  });

  it('enriches devices with live rates and totals from scheduler', async () => {
    const pool = createMockPool();
    const liveDeviceMap = new Map<string, NormalizedDevice>([
      [
        'mac:AA:BB:CC:DD:EE:01',
        {
          mac: 'AA:BB:CC:DD:EE:01',
          name: 'my-phone',
          ip: '192.168.31.50',
          online: true,
          downspeed: 1048576,
          upspeed: 262144,
          downloadTotal: 50000000,
          uploadTotal: 10000000,
          connectionType: 'wifi_5g'
        }
      ]
    ]);

    const mockScheduler = {
      getStatus: () => null,
      getLatestDevices: (routerId: string) => {
        return routerId === 'router-1' ? liveDeviceMap : null;
      }
    } as unknown as PollingScheduler;

    const app = await buildApp({ pool, scheduler: mockScheduler });
    await app.ready();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/routers/router-1/devices',
        headers: { cookie: AUTH_COOKIE }
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body) as { devices: Array<Record<string, unknown>> };
      assert.equal(body.devices.length, 1);
      const dev = body.devices[0]!;
      assert.equal(dev.downspeed, 1048576);
      assert.equal(dev.upspeed, 262144);
      assert.equal(dev.downloadTotal, 50000000);
      assert.equal(dev.uploadTotal, 10000000);
      assert.equal(dev.connectionType, 'wifi_5g');
    } finally {
      await app.close();
    }
  });

  it('PollingScheduler updates device online state to false when missing from inventory', async () => {
    let recordedEventKind: string | null = null;
    let updatedOnlineState: boolean | null = null;

    const mockPool = createMockPool();
    const mockRouterRepo = {
      listRouters: async () => [
        {
          id: 'router-1',
          host: '192.168.31.1',
          compatibility: 'SUPPORTED' as const
        }
      ],
      loadCredential: async () => ({
        username: 'admin',
        password: 'pwd'
      })
    };

    const mockObsRepo = {
      listDevicesForRouter: async () => [
        {
          id: 'dev-1',
          routerId: 'router-1',
          mac: 'AA:BB:CC:DD:EE:01',
          name: 'phone',
          ip: '192.168.31.50',
          online: true,
          internetAccess: true,
          firstSeenAt: new Date(),
          lastSeenAt: new Date()
        }
      ],
      recordPresenceEvent: async (_devId: string, _routerId: string, kind: string) => {
        recordedEventKind = kind;
      },
      batchUpdateDeviceObservations: async (updates: Array<{ id: string; online: boolean }>) => {
        if (updates.length > 0) {
          updatedOnlineState = updates[0]!.online;
        }
      },
      updateDeviceObservation: async (_devId: string, fields: { online: boolean }) => {
        updatedOnlineState = fields.online;
      }
    };

    const { EventBridge } = await import('../src/observability/event-bridge.js');
    const { PollingScheduler } = await import('../src/observability/scheduler.js');
    const events = new EventBridge();

    const scheduler = new PollingScheduler(
      mockPool,
      mockRouterRepo as never,
      mockObsRepo as never,
      events,
      'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    );

    // Mock adapter that returns an empty device list (device missing/disconnected)
    const mockAdapter = {
      call: async (key: string) => {
        if (key === 'deviceList') {
          return { status: 200, body: { code: 0, list: [] } };
        }
        return { status: 200, body: { code: 0 } };
      }
    };
    (scheduler as unknown as { adapters: Map<string, unknown> }).adapters.set('router-1', mockAdapter);

    // Call private pollInventoryAll
    await (scheduler as unknown as { pollInventoryAll: () => Promise<void> }).pollInventoryAll();

    assert.equal(recordedEventKind, 'OFFLINE', 'must record OFFLINE presence event');
    assert.equal(updatedOnlineState, false, 'must update device table online column to false');
  });

  it('PollingScheduler does not emit spurious OFFLINE event for online device with both mac and ip', async () => {
    let recordedEventKind: string | null = null;
    let updatedOnlineState: boolean | null = null;

    const mockPool = createMockPool();
    const mockRouterRepo = {
      listRouters: async () => [
        {
          id: 'router-1',
          host: '192.168.31.1',
          compatibility: 'SUPPORTED' as const
        }
      ],
      loadCredential: async () => ({
        username: 'admin',
        password: 'pwd'
      })
    };

    const mockObsRepo = {
      listDevicesForRouter: async () => [
        {
          id: 'dev-1',
          routerId: 'router-1',
          mac: 'AA:BB:CC:DD:EE:01',
          name: 'phone',
          ip: '192.168.31.50',
          online: true,
          internetAccess: true,
          firstSeenAt: new Date(),
          lastSeenAt: new Date()
        }
      ],
      recordPresenceEvent: async (_devId: string, _routerId: string, kind: string) => {
        recordedEventKind = kind;
      },
      batchUpdateDeviceObservations: async (updates: Array<{ id: string; online: boolean }>) => {
        if (updates.length > 0) {
          updatedOnlineState = updates[0]!.online;
        }
      },
      updateDeviceObservation: async (_devId: string, fields: { online: boolean }) => {
        updatedOnlineState = fields.online;
      }
    };

    const { EventBridge } = await import('../src/observability/event-bridge.js');
    const { PollingScheduler } = await import('../src/observability/scheduler.js');
    const events = new EventBridge();

    const scheduler = new PollingScheduler(
      mockPool,
      mockRouterRepo as never,
      mockObsRepo as never,
      events,
      'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    );

    // Mock adapter that returns the device online with matching MAC and IP
    const mockAdapter = {
      call: async (key: string) => {
        if (key === 'deviceList') {
          return {
            status: 200,
            body: {
              code: 0,
              list: [
                {
                  mac: 'AA:BB:CC:DD:EE:01',
                  ip: '192.168.31.50',
                  online: true
                }
              ]
            }
          };
        }
        return { status: 200, body: { code: 0 } };
      }
    };
    (scheduler as unknown as { adapters: Map<string, unknown> }).adapters.set('router-1', mockAdapter);

    // Call private pollInventoryAll
    await (scheduler as unknown as { pollInventoryAll: () => Promise<void> }).pollInventoryAll();

    assert.equal(recordedEventKind, null, 'must NOT record any presence event for continuously online device');
    assert.notEqual(updatedOnlineState, false, 'device observation must not be marked offline');
    assert.equal(updatedOnlineState, null, 'unchanged device observation is skipped to avoid disk I/O');
  });

  it('PollingScheduler calls batchUpdateDeviceObservations when device attributes change', async () => {
    let batchedUpdates: Array<{ id: string; online: boolean; ip?: string | null; name?: string | null }> = [];

    const mockPool = createMockPool();
    const mockRouterRepo = {
      listRouters: async () => [
        {
          id: 'router-1',
          host: '192.168.31.1',
          compatibility: 'SUPPORTED' as const
        }
      ],
      loadCredential: async () => ({
        username: 'admin',
        password: 'pwd'
      })
    };

    const mockObsRepo = {
      listDevicesForRouter: async () => [
        {
          id: 'dev-1',
          routerId: 'router-1',
          mac: 'AA:BB:CC:DD:EE:01',
          name: 'old-phone',
          ip: '192.168.31.50',
          online: true,
          internetAccess: true,
          firstSeenAt: new Date(),
          lastSeenAt: new Date()
        }
      ],
      recordPresenceEvent: async () => {},
      batchUpdateDeviceObservations: async (updates: typeof batchedUpdates) => {
        batchedUpdates = [...updates];
      }
    };

    const { EventBridge } = await import('../src/observability/event-bridge.js');
    const { PollingScheduler } = await import('../src/observability/scheduler.js');
    const events = new EventBridge();

    const scheduler = new PollingScheduler(
      mockPool,
      mockRouterRepo as never,
      mockObsRepo as never,
      events,
      'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    );

    // Device IP has changed to .55 and name to new-phone
    const mockAdapter = {
      call: async (key: string) => {
        if (key === 'deviceList') {
          return {
            status: 200,
            body: {
              code: 0,
              list: [
                {
                  mac: 'AA:BB:CC:DD:EE:01',
                  ip: '192.168.31.55',
                  name: 'new-phone',
                  online: true
                }
              ]
            }
          };
        }
        return { status: 200, body: { code: 0 } };
      }
    };
    (scheduler as unknown as { adapters: Map<string, unknown> }).adapters.set('router-1', mockAdapter);

    await (scheduler as unknown as { pollInventoryAll: () => Promise<void> }).pollInventoryAll();

    assert.equal(batchedUpdates.length, 1);
    assert.equal(batchedUpdates[0]?.id, 'dev-1');
    assert.equal(batchedUpdates[0]?.ip, '192.168.31.55');
    assert.equal(batchedUpdates[0]?.name, 'new-phone');
    assert.equal(batchedUpdates[0]?.online, true);
  });

  it('PollingScheduler refreshes stale heartbeat when last_seen_at is older than 10 minutes', async () => {
    let batchedUpdates: Array<{ id: string; online: boolean }> = [];

    const mockPool = createMockPool();
    const mockRouterRepo = {
      listRouters: async () => [
        {
          id: 'router-1',
          host: '192.168.31.1',
          compatibility: 'SUPPORTED' as const
        }
      ],
      loadCredential: async () => ({
        username: 'admin',
        password: 'pwd'
      })
    };

    // Device last seen 15 minutes ago
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const mockObsRepo = {
      listDevicesForRouter: async () => [
        {
          id: 'dev-1',
          routerId: 'router-1',
          mac: 'AA:BB:CC:DD:EE:01',
          name: 'phone',
          ip: '192.168.31.50',
          online: true,
          internetAccess: true,
          firstSeenAt: fifteenMinutesAgo,
          lastSeenAt: fifteenMinutesAgo
        }
      ],
      recordPresenceEvent: async () => {},
      batchUpdateDeviceObservations: async (updates: typeof batchedUpdates) => {
        batchedUpdates = [...updates];
      }
    };

    const { EventBridge } = await import('../src/observability/event-bridge.js');
    const { PollingScheduler } = await import('../src/observability/scheduler.js');
    const events = new EventBridge();

    const scheduler = new PollingScheduler(
      mockPool,
      mockRouterRepo as never,
      mockObsRepo as never,
      events,
      'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
    );

    const mockAdapter = {
      call: async (key: string) => {
        if (key === 'deviceList') {
          return {
            status: 200,
            body: {
              code: 0,
              list: [
                {
                  mac: 'AA:BB:CC:DD:EE:01',
                  ip: '192.168.31.50',
                  online: true
                }
              ]
            }
          };
        }
        return { status: 200, body: { code: 0 } };
      }
    };
    (scheduler as unknown as { adapters: Map<string, unknown> }).adapters.set('router-1', mockAdapter);

    await (scheduler as unknown as { pollInventoryAll: () => Promise<void> }).pollInventoryAll();

    assert.equal(batchedUpdates.length, 1, 'must trigger coarse heartbeat update after 10m');
    assert.equal(batchedUpdates[0]?.id, 'dev-1');
  });
});
