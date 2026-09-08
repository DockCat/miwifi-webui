/**
 * Investigation session integration tests (Task 0011).
 *
 * Verifies against a throwaway PostgreSQL:
 * - a turn without sessionId lazily creates a session (first question
 *   names it) and the response carries the sessionId;
 * - follow-up turns attach to the session; the route replays prior
 *   completed exchanges as conversation context (observable in the
 *   provider request body) and seeds aliases from prior legends;
 * - closed sessions reject further turns (409) and turn read-only;
 * - the sessions list orders by last activity with turn counts;
 * - retention purge cascades sessions with their turns.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import process from 'node:process';
import { buildApp } from '../src/app.js';
import { applyMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { RouterRepository } from '../src/router/repository.js';
import { RetentionRepository } from '../src/retention/repository.js';
import { deviceTrafficUsageTool } from '../src/ai/tools.js';
import { AliasMap, EXTERNAL_PRIVACY } from '../src/ai/privacy.js';
import type { FastifyInstance } from 'fastify';

const BASE = 'postgres://miwifi:miwifi-dev-password@localhost:5432';
const TEST_DB = 'miwifi_sessions_test';

let pool: pg.Pool;
let app: FastifyInstance;
let cookie: string;
let routerId: string;

/** Captured provider request bodies (answers with a canned finding). */
let providerBodies: string[] = [];

before(async () => {
  const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  pool = createPool(`${BASE}/${TEST_DB}`);
  await applyMigrations(pool);

  // AI provider: external mode pointing at a mock so the agent loop runs
  // offline. fetch is patched below to intercept the calls.
  process.env.AI_PROVIDER_MODE = 'external';
  process.env.AI_PROVIDER_BASE_URL = 'http://provider.test/v1';
  process.env.AI_PROVIDER_MODEL = 'test-model';
  delete process.env.AI_EXTERNAL_SEND_NAMES;

  app = await buildApp({ pool });
  await app.ready();

  const bootstrap = await app.inject({
    method: 'POST',
    url: '/api/auth/bootstrap',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ username: 'admin', password: 'SessionTest-123456' })
  });
  const setCookie = bootstrap.headers['set-cookie'];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0]!;

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
  delete process.env.AI_PROVIDER_MODE;
  delete process.env.AI_PROVIDER_BASE_URL;
  delete process.env.AI_PROVIDER_MODEL;
  const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();
});

/** Patch fetch for provider calls; every request is recorded and answered. */
function mockProvider(finding: string): void {
  providerBodies = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    providerBodies.push(String(init?.body ?? ''));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: finding } }] }),
      { status: 200 }
    );
  }) as typeof fetch;
  (mockProvider as { restore?: () => void }).restore = () => {
    globalThis.fetch = original;
  };
}

function restoreProvider(): void {
  (mockProvider as { restore?: () => void }).restore?.();
}

interface CreateResponse {
  statusCode: number;
  body: string;
}

async function postTurn(
  question: string,
  opts: { sessionId?: string; locale?: string } = {}
): Promise<CreateResponse & { sessionId?: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/investigations',
    headers: { cookie, 'content-type': 'application/json' },
    payload: JSON.stringify({
      routerId,
      question,
      sessionId: opts.sessionId,
      locale: opts.locale ?? 'en'
    })
  });
  const parsed = JSON.parse(response.body) as { sessionId?: string; error?: string };
  return { statusCode: response.statusCode, body: response.body, sessionId: parsed.sessionId };
}

describe('session lifecycle', () => {
  it('first turn lazily creates a session named by the question', async () => {
    mockProvider('first finding: all good');
    try {
      const turn = await postTurn('Why did the TV disconnect at 14:32 and reconnect later?');
      assert.equal(turn.statusCode, 200, turn.body);
      assert.ok(turn.sessionId, 'response carries sessionId');

      const list = await app.inject({
        method: 'GET',
        url: '/api/investigations/sessions',
        headers: { cookie }
      });
      assert.equal(list.statusCode, 200);
      const body = JSON.parse(list.body) as {
        sessions: { id: string; title: string; status: string; turnCount: number }[];
      };
      assert.equal(body.sessions.length, 1);
      assert.equal(body.sessions[0]!.id, turn.sessionId);
      assert.ok(
        body.sessions[0]!.title.startsWith('Why did the TV disconnect at 14:32'),
        'title = first question'
      );
      assert.equal(body.sessions[0]!.status, 'open');
      assert.equal(body.sessions[0]!.turnCount, 1);
    } finally {
      restoreProvider();
    }
  });

  it('second turn joins the session and replays conversation context', async () => {
    const sessions = await app.inject({
      method: 'GET',
      url: '/api/investigations/sessions',
      headers: { cookie }
    });
    const { sessions: rows } = JSON.parse(sessions.body) as {
      sessions: { id: string }[];
    };
    const sessionId = rows[0]!.id;

    mockProvider('second finding: the TV reconnected');
    try {
      const turn = await postTurn('and the busiest device?', { sessionId });
      assert.equal(turn.statusCode, 200, turn.body);
      assert.equal(turn.sessionId, sessionId, 'same session continues');

      // The provider saw the prior exchange + the new question, plus the
      // system prompt with the locale directive.
      const first = JSON.parse(providerBodies[0]!) as {
        messages: Array<{ role: string; content: string }>;
      };
      const roles = first.messages.map((m) => m.role);
      assert.deepEqual(roles, ['system', 'user', 'assistant', 'user'], 'history replayed');
      assert.ok(
        first.messages.some((m) => m.role === 'user' && m.content.includes('TV disconnect')),
        'prior question replayed'
      );
      assert.ok(
        first.messages.some((m) => m.role === 'assistant' && m.content.includes('first finding')),
        'prior finding replayed'
      );

      // Session detail shows both turns oldest-first.
      const detail = await app.inject({
        method: 'GET',
        url: `/api/investigations/sessions/${sessionId}`,
        headers: { cookie }
      });
      assert.equal(detail.statusCode, 200);
      const detailBody = JSON.parse(detail.body) as {
        investigations: { question: string }[];
      };
      assert.equal(detailBody.investigations.length, 2);
      assert.ok(detailBody.investigations[0]!.question.includes('TV disconnect'));
      assert.ok(detailBody.investigations[1]!.question.includes('busiest'));
    } finally {
      restoreProvider();
    }
  });

  it('closing a session makes it read-only (409 on new turns)', async () => {
    const sessions = await app.inject({
      method: 'GET',
      url: '/api/investigations/sessions',
      headers: { cookie }
    });
    const { sessions: rows } = JSON.parse(sessions.body) as {
      sessions: { id: string }[];
    };
    const sessionId = rows[0]!.id;

    const close = await app.inject({
      method: 'POST',
      url: `/api/investigations/sessions/${sessionId}/close`,
      headers: { cookie }
    });
    assert.equal(close.statusCode, 200, close.body);

    // Second close is a conflict.
    const reclose = await app.inject({
      method: 'POST',
      url: `/api/investigations/sessions/${sessionId}/close`,
      headers: { cookie }
    });
    assert.equal(reclose.statusCode, 409);
    assert.equal(JSON.parse(reclose.body).error, 'session_already_closed');

    // A turn against the closed session is rejected without calling the
    // provider.
    const providerCallsBefore = providerBodies.length;
    const turn = await postTurn('one more question?', { sessionId });
    assert.equal(turn.statusCode, 409);
    assert.equal(JSON.parse(turn.body).error, 'session_closed');
    assert.equal(providerBodies.length, providerCallsBefore, 'provider never called');
  });

  it('locale zh-CN reaches the system prompt', async () => {
    mockProvider('zh finding');
    try {
      const turn = await postTurn('為什麼電視斷線?', { locale: 'zh-CN' });
      assert.equal(turn.statusCode, 200, turn.body);
      const first = JSON.parse(providerBodies[0]!) as {
        messages: Array<{ role: string; content: string }>;
      };
      assert.ok(
        first.messages[0]!.content.includes('Simplified Chinese'),
        'locale directive in system prompt'
      );
    } finally {
      restoreProvider();
    }
  });

  it('unknown session ids are 404', async () => {
    const turn = await postTurn('valid question here', {
      sessionId: '00000000-0000-0000-0000-000000000000'
    });
    assert.equal(turn.statusCode, 404);
    assert.equal(JSON.parse(turn.body).error, 'session_not_found');
  });
});

describe('session retention', () => {
  it('purges old sessions with their turns (cascade)', async () => {
    // Age an old session beyond the window, keep a fresh one.
    const oldSession = await pool.query<{ id: string }>(
      `INSERT INTO investigation_session (router_id, title, last_activity_at, created_at)
       VALUES ($1, 'old session', now() - interval '40 days', now() - interval '40 days')
       RETURNING id::text AS id`,
      [routerId]
    );
    await pool.query(
      `INSERT INTO investigation (session_id, provider, question, status)
       VALUES ($1, 'local', 'old question', 'completed')`,
      [oldSession.rows[0]!.id]
    );

    const retention = new RetentionRepository(pool);
    const results = await retention.purgeAll({
      telemetryDays: 90,
      presenceDays: 365,
      auditDays: 365,
      investigationDays: 30
    });
    const sessionPurge = results.find((r) => r.category === 'investigation_session');
    assert.ok(sessionPurge, 'session category reported');
    assert.ok(sessionPurge.purged >= 1, 'old session purged');

    const remaining = await pool.query<{ count: string }>(
      'SELECT count(*)::int AS count FROM investigation_session'
    );
    const oldGone = await pool.query<{ count: string }>(
      'SELECT count(*)::int AS count FROM investigation WHERE session_id = $1',
      [oldSession.rows[0]!.id]
    );
    assert.equal(Number(oldGone.rows[0]!.count), 0, 'turns cascaded with the session');
    assert.ok(Number(remaining.rows[0]!.count) >= 1, 'fresh sessions survive');
  });
});


describe('full context and safe session rotation', () => {
  it('rotates instead of dropping history and keeps the old session readable', async () => {
    mockProvider('first finding');
    try {
      const first = await postTurn('start a long conversation');
      await pool.query("UPDATE investigation SET finding = $2, transcript = '[]' WHERE session_id = $1", [first.sessionId, 'x'.repeat(48_001)]);
      const next = await postTurn('a new question after the limit', { sessionId: first.sessionId });
      assert.equal(next.statusCode, 200, next.body);
      assert.notEqual(next.sessionId, first.sessionId);
      assert.equal(JSON.parse(next.body).rotatedFrom, first.sessionId);
      const old = await app.inject({ method: 'GET', url: `/api/investigations/sessions/${first.sessionId}`, headers: { cookie } });
      assert.equal(JSON.parse(old.body).session.status, 'closed');
      assert.equal(JSON.parse(old.body).investigations[0].finding.length, 48_001);
      const body = JSON.parse(providerBodies.at(-1)!);
      assert.deepEqual(body.messages.map((m: { role: string }) => m.role), ['system', 'user']);
    } finally { restoreProvider(); }
  });

  it('rejects concurrent turns and close while a provider response is pending', async () => {
    mockProvider('initial');
    let id: string;
    try { id = (await postTurn('concurrency test session')).sessionId!; } finally { restoreProvider(); }
    const original = globalThis.fetch;
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = (async () => { entered(); await gate;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }));
    }) as typeof fetch;
    const first = postTurn('pending question', { sessionId: id });
    try {
      await reached;
      const second = await postTurn('parallel question', { sessionId: id });
      assert.equal(second.statusCode, 409);
      assert.equal(JSON.parse(second.body).error, 'session_busy');
      const close = await app.inject({ method: 'POST', url: `/api/investigations/sessions/${id}/close`, headers: { cookie } });
      assert.equal(close.statusCode, 409);
    } finally { release(); await first; globalThis.fetch = original; }
  });

  it('does not create empty sessions when AI is disabled', async () => {
    const before = await pool.query('SELECT count(*) FROM investigation_session');
    delete process.env.AI_PROVIDER_MODE;
    try {
      assert.equal((await postTurn('disabled question')).statusCode, 503);
      const after = await pool.query('SELECT count(*) FROM investigation_session');
      assert.equal(after.rows[0].count, before.rows[0].count);
    } finally { process.env.AI_PROVIDER_MODE = 'external'; }
  });
});

describe('device traffic SQL correctness', () => {
  it('ranks deltas not lifetime totals, handles resets/gaps and excludes other routers', async () => {
    const insert = async (hoursAgo: number, devices: unknown[]) => {
      await pool.query(`INSERT INTO telemetry_snapshot (router_id, captured_at, payload)
        VALUES ($1, now() - $2::float * interval '1 hour', $3::jsonb)`,
        [routerId, hoursAgo, JSON.stringify({ devices })]);
    };
    const a = 'AA:BB:CC:DD:EE:01', b = 'AA:BB:CC:DD:EE:02';
    await insert(25, [{ mac: a, downloadTotal: 1 }, { mac: b, downloadTotal: 0 }]);
    await insert(23, [{ mac: a, downloadTotal: 10000 }, { mac: b, downloadTotal: 100 }]);
    await insert(12, [{ mac: a, downloadTotal: 10020 }, { mac: b, downloadTotal: 400 }]);
    await insert(2, [{ mac: a, downloadTotal: 10 }, { mac: b, downloadTotal: 600 }]);
    await insert(1, [{ mac: a, downloadTotal: 15 }, { mac: b, downloadTotal: 600 }]);
    const aliases = new AliasMap();
    aliases.registerDevice({ id: 'a', mac: a, name: 'SENTINEL-A' });
    aliases.registerDevice({ id: 'b', mac: b, name: 'SENTINEL-B' });
    const result = await deviceTrafficUsageTool.execute({ pool, routerId, privacy: EXTERNAL_PRIVACY, aliases }, { hours: 24, limit: 10 });
    const devices = result.devices as Array<Record<string, unknown>>;
    assert.equal(devices.length, 2);
    assert.equal(devices[0]!.name, aliases.aliasFor('device', b));
    assert.equal(devices[0]!.downloadBytes, '500');
    const bPeak = devices[0]!.peakInterval as Record<string, unknown>;
    assert.equal(bPeak.downloadBytes, '300');
    assert.ok(typeof bPeak.startAt === 'string' && typeof bPeak.endAt === 'string');
    assert.ok(typeof bPeak.startEvidenceId === 'string' && typeof bPeak.endEvidenceId === 'string');
    assert.equal(result.timezone, 'UTC');
    assert.equal(devices[1]!.downloadBytes, '25');
    const aPeak = devices[1]!.peakInterval as Record<string, unknown>;
    assert.equal(aPeak.downloadBytes, '20');
    assert.equal(devices[1]!.resets, 1);
    assert.equal(devices[0]!.sampleCount, 4);
    assert.ok(Number(devices[0]!.maxGapSeconds) > 3600);
    assert.equal(result.quality, 'sampled_partial');
    assert.ok(!JSON.stringify(result).includes('AA:BB'));
    assert.ok(!JSON.stringify(result).includes('SENTINEL'));
    const empty = await deviceTrafficUsageTool.execute({ pool, routerId: '00000000-0000-0000-0000-000000000000', privacy: EXTERNAL_PRIVACY, aliases }, { hours: 24, limit: 10 });
    assert.deepEqual(empty.devices, []);
    assert.equal(empty.quality, 'unavailable');
  });

  it('does not rank a device without a usable counter interval', async () => {
    const otherRouter = await new RouterRepository(pool).upsertRouter({
      host: '192.168.31.2', model: 'RD03', hardware: 'RD03', romVersion: '2.28.23',
      channel: 'release', compatibility: 'SUPPORTED', capabilities: ['device-inventory']
    });
    await pool.query(`INSERT INTO telemetry_snapshot (router_id, payload)
      VALUES ($1, $2::jsonb)`, [otherRouter.id, JSON.stringify({ devices: [
      { mac: 'AA:BB:CC:DD:EE:09', downloadTotal: 0, downloadCounterAvailable: false }
    ] })]);
    const aliases = new AliasMap();
    const result = await deviceTrafficUsageTool.execute(
      { pool, routerId: otherRouter.id, privacy: EXTERNAL_PRIVACY, aliases },
      { hours: 24, limit: 10 }
    );
    assert.equal(result.quality, 'unavailable');
    assert.deepEqual(result.devices, []);
  });
});
