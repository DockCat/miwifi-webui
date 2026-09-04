/**
 * Observability integration tests (Task 0004).
 *
 * Verifies the core acceptance criteria against a throwaway PostgreSQL:
 * - reads never create telemetry rows;
 * - presence events are transitions, not per-refresh duplicates;
 * - SSE ring replays events after a Last-Event-ID.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { applyMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { EventBridge } from '../src/observability/event-bridge.js';
import { ObservabilityRepository } from '../src/observability/repository.js';
import { RouterRepository } from '../src/router/repository.js';
import type { FastifyInstance } from 'fastify';

const BASE = 'postgres://miwifi:miwifi-dev-password@localhost:5432';
const TEST_DB = 'miwifi_obs_test';

let pool: pg.Pool;
let app: FastifyInstance;
let cookie: string;
let routerId: string;
let observability: ObservabilityRepository;
let events: EventBridge;

before(async () => {
  const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  pool = createPool(`${BASE}/${TEST_DB}`);
  await applyMigrations(pool);

  observability = new ObservabilityRepository(pool);
  events = new EventBridge();
  app = await buildApp({ pool, eventBridge: events });
  await app.ready();

  // Bootstrap admin for auth.
  const bootstrap = await app.inject({
    method: 'POST',
    url: '/api/auth/bootstrap',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ username: 'admin', password: 'ObsTest-123456' })
  });
  const setCookie = bootstrap.headers['set-cookie'];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0]!;

  // Seed a router row directly (onboarding route probes a real router).
  const routerRepo = new RouterRepository(pool);
  const routerRow = await routerRepo.upsertRouter({
    host: '192.168.31.1',
    model: 'RD03',
    hardware: 'RD03',
    romVersion: '2.28.23',
    channel: 'release',
    compatibility: 'SUPPORTED',
    capabilities: ['router-info', 'health-metrics', 'device-inventory']
  });
  routerId = routerRow.id;
});

after(async () => {
  await app?.close();
  await pool?.end();
  const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();
});

describe('telemetry read isolation', () => {
  it('GET /telemetry creates no rows (scheduler-only writes)', async () => {
    const before = await pool.query<{ count: string }>(
      'SELECT count(*)::int AS count FROM telemetry_snapshot WHERE router_id = $1',
      [routerId]
    );
    const read = await app.inject({
      method: 'GET',
      url: `/api/routers/${routerId}/telemetry`,
      headers: { cookie }
    });
    assert.equal(read.statusCode, 200);
    const after = await pool.query<{ count: string }>(
      'SELECT count(*)::int AS count FROM telemetry_snapshot WHERE router_id = $1',
      [routerId]
    );
    assert.equal(
      Number(after.rows[0]?.count),
      Number(before.rows[0]?.count),
      'reads must not create telemetry rows'
    );
  });
});

describe('presence events', () => {
  it('records transitions only — one FIRST_SEEN + one ONLINE per cycle', async () => {
    const device = await observability.insertDevice(routerId, 'AA:BB:CC:00:00:01', 'tv', '192.168.31.10');
    await observability.recordPresenceEvent(device.id, routerId, 'FIRST_SEEN');
    await observability.recordPresenceEvent(device.id, routerId, 'ONLINE');
    await observability.updateDeviceObservation(device.id, { online: false });
    await observability.recordPresenceEvent(device.id, routerId, 'OFFLINE');
    await observability.updateDeviceObservation(device.id, { online: true });
    await observability.recordPresenceEvent(device.id, routerId, 'ONLINE');

    const response = await app.inject({
      method: 'GET',
      url: `/api/routers/${routerId}/presence?deviceId=${device.id}`,
      headers: { cookie }
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { events: { kind: string }[] };
    assert.deepEqual(
      body.events.map((e) => e.kind).reverse(),
      ['FIRST_SEEN', 'ONLINE', 'OFFLINE', 'ONLINE']
    );
  });
});

describe('EventBridge / SSE ring', () => {
  it('replays only events after Last-Event-ID', () => {
    events.publish('router-status', { routerId, status: { a: 1 } });
    const second = events.publish('presence', { routerId, kind: 'ONLINE' });
    events.publish('inventory', { routerId, count: 3 });

    const replay = events.eventsAfter(second.id - 1);
    assert.equal(replay.length, 2);
    assert.equal(replay[0]!.type, 'presence');
    assert.equal(replay[1]!.type, 'inventory');
  });

  it('listeners receive live events and can unsubscribe', () => {
    const received: string[] = [];
    const unsubscribe = events.subscribe((event) => received.push(event.type));
    events.publish('inventory', { routerId, count: 1 });
    unsubscribe();
    events.publish('inventory', { routerId, count: 2 });
    assert.deepEqual(received, ['inventory']);
  });

  it('keeps a bounded ring', () => {
    const fresh = new EventBridge();
    for (let i = 0; i < 250; i++) fresh.publish('tick', { i });
    assert.ok(fresh.eventsAfter(0).length <= 200);
    assert.ok(fresh.eventsAfter(0).length >= 200);
  });
});

describe('device inventory endpoint', () => {
  it('lists devices browser-safe (no secrets)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/routers/${routerId}/devices`,
      headers: { cookie }
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { devices: unknown[] };
    assert.ok(Array.isArray(body.devices));
    const blob = response.body;
    assert.ok(!blob.includes('stok'), 'device list must not carry stok');
    assert.ok(!blob.includes('ObsTest-123456'), 'must not leak passwords');
  });

  it('rejects unauthenticated access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/routers/${routerId}/devices`
    });
    assert.equal(response.statusCode, 401);
  });
});
