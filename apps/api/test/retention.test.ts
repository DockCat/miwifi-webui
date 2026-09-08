/**
 * Retention tests (Task 0008): policy loading, cutoff math with clock
 * injection, purge behavior against a throwaway database.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import process from 'node:process';
import { applyMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import {
  DEFAULT_RETENTION,
  loadRetentionPolicy,
  retentionCutoff,
  type RetentionClock
} from '../src/retention/policy.js';
import { RetentionRepository } from '../src/retention/repository.js';
import { ObservabilityRepository } from '../src/observability/repository.js';

const BASE = 'postgres://miwifi:miwifi-dev-password@localhost:5432';
const TEST_DB = 'miwifi_retention_test';

// Frozen clock: 2026-09-05T00:00:00Z.
const FIXED_NOW = new Date('2026-09-05T00:00:00Z');
const fixedClock: RetentionClock = { now: () => new Date(FIXED_NOW.getTime()) };

let pool: pg.Pool;

before(async () => {
  const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  pool = createPool(`${BASE}/${TEST_DB}`);
  await applyMigrations(pool);
});

after(async () => {
  await pool?.end();
  const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();
});

describe('retention policy', () => {
  it('defaults match the plan (90/365/365/30)', () => {
    assert.deepEqual(DEFAULT_RETENTION, {
      telemetryDays: 90,
      presenceDays: 365,
      auditDays: 365,
      investigationDays: 30
    });
  });

  it('loads overrides from env, rejecting malformed values', () => {
    process.env.RETENTION_TELEMETRY_DAYS = '30';
    process.env.RETENTION_AUDIT_DAYS = 'garbage';
    process.env.RETENTION_INVESTIGATION_DAYS = '-5';
    const policy = loadRetentionPolicy();
    assert.equal(policy.telemetryDays, 30);
    assert.equal(policy.auditDays, 365, 'garbage falls back');
    assert.equal(policy.investigationDays, 30, 'negative falls back');
    delete process.env.RETENTION_TELEMETRY_DAYS;
    delete process.env.RETENTION_AUDIT_DAYS;
    delete process.env.RETENTION_INVESTIGATION_DAYS;
  });

  it('computes cutoffs from an injected clock (pure math)', () => {
    const policy = { telemetryDays: 90, presenceDays: 365, auditDays: 365, investigationDays: 30 };
    const telemetryCutoff = retentionCutoff(policy, 'telemetryDays', fixedClock);
    assert.equal(telemetryCutoff.toISOString(), '2026-06-07T00:00:00.000Z');
    const investigationCutoff = retentionCutoff(policy, 'investigationDays', fixedClock);
    assert.equal(investigationCutoff.toISOString(), '2026-08-06T00:00:00.000Z');
  });
});

describe('retention purges', () => {
  it('purges only rows older than each window', async () => {
    const observability = new ObservabilityRepository(pool);
    const retention = new RetentionRepository(pool);
    const policy = DEFAULT_RETENTION;

    // Seed a router + old and fresh telemetry.
    const router = await pool.query<{ id: string }>(
      `INSERT INTO router (host, compatibility) VALUES ('192.168.31.1', 'SUPPORTED') RETURNING id::text AS id`
    );
    const routerId = router.rows[0]!.id;

    // 100 days old (outside telemetry window) + fresh.
    const oldDate = new Date(FIXED_NOW.getTime() - 100 * 24 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO telemetry_snapshot (router_id, captured_at, payload) VALUES ($1, $2, $3)',
      [routerId, oldDate.toISOString(), JSON.stringify({ cpu: 1 })]
    );
    await observability.insertTelemetrySnapshot(routerId, { cpu: 2 });

    const result = await retention.purgeTelemetry(policy, fixedClock);
    assert.equal(result.category, 'telemetry');
    assert.ok(result.purged >= 1, 'old row purged');

    const remaining = await pool.query<{ count: string }>(
      'SELECT count(*)::int AS count FROM telemetry_snapshot WHERE router_id = $1',
      [routerId]
    );
    assert.equal(Number(remaining.rows[0]?.count), 1, 'fresh row kept');
  });

  it('purgeAll reports every category', async () => {
    const retention = new RetentionRepository(pool);
    const results = await retention.purgeAll(DEFAULT_RETENTION, fixedClock);
    assert.deepEqual(
      results.map((r) => r.category),
      ['telemetry', 'presence', 'audit', 'investigation', 'investigation_session']
    );
  });
});
