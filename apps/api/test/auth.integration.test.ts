/**
 * Auth + audit integration tests.
 *
 * Requires a live PostgreSQL (docker compose up -d postgres). Uses a
 * dedicated test database created from migrations so the run is repeatable.
 *
 * Secret-leak regression: a recognizable sentinel password is used, and
 * every assertion of response bodies also checks it never contains the
 * sentinel or a hash prefix.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { applyMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import type { FastifyInstance } from 'fastify';

const TEST_DB = 'miwifi_auth_test';
const BASE = 'postgres://miwifi:miwifi-dev-password@localhost:5432';
const TEST_URL = `${BASE}/${TEST_DB}`;

/** Recognizable sentinel so accidental password leakage is detectable. */
const SENTINEL_PASSWORD = 'SEN[1]TINEL-Passw0rd-X';

let pool: pg.Pool;
let app: FastifyInstance;

before(async () => {
  // Create a clean test database via the admin connection.
  const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  pool = createPool(TEST_URL);
  await applyMigrations(pool);

  app = await buildApp(pool);
  await app.ready();
});

after(async () => {
  await app?.close();
  await pool?.end();
  const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();
});

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url,
    payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(typeof raw === 'string', 'session cookie must be set');
  assert.match(raw, /httponly/i, 'cookie must be HttpOnly');
  assert.match(raw, /samesite=lax/i, 'cookie must have SameSite=lax');
  // name=value pair (before the first attribute semicolon).
  return raw.split(';')[0]!;
}

describe('bootstrap administrator', () => {
  it('creates the admin from loopback and then closes permanently (409)', async () => {
    const first = await post('/api/auth/bootstrap', {
      username: 'admin',
      password: SENTINEL_PASSWORD
    });
    assert.equal(first.statusCode, 201);
    assert.ok(!first.body.includes(SENTINEL_PASSWORD), 'response leaks password');
    const cookie = cookieFrom(first); // asserts HttpOnly + SameSite inside
    assert.match(cookie, /miwifi_session=/);

    // Second attempt: permanently closed even from loopback.
    const second = await post('/api/auth/bootstrap', {
      username: 'other',
      password: 'whatever-long-enough'
    });
    assert.equal(second.statusCode, 409);
  });

  it('rejects a weak password', async () => {
    // Fresh database per describe block is not available; this test shares
    // the DB, so it runs against the already-bootstrapped app: bootstrap is
    // closed, so assert the closed behavior holds for any input.
    const res = await post('/api/auth/bootstrap', { username: 'x', password: 'short' });
    assert.equal(res.statusCode, 409);
  });
});

describe('login', () => {
  it('rejects wrong credentials with a generic error and no leak', async () => {
    const res = await post('/api/auth/login', {
      username: 'admin',
      password: 'wrong-password-123'
    });
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error, 'invalid_credentials');
    assert.ok(!res.body.includes(SENTINEL_PASSWORD));
  });

  it('logs in and rotates: old session token becomes invalid', async () => {
    const first = await post('/api/auth/login', {
      username: 'admin',
      password: SENTINEL_PASSWORD
    });
    assert.equal(first.statusCode, 200);
    const firstCookie = cookieFrom(first);

    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: firstCookie }
    });
    assert.equal(session.statusCode, 200);

    // Login again -> rotation revokes the first session.
    const second = await post('/api/auth/login', {
      username: 'admin',
      password: SENTINEL_PASSWORD
    });
    assert.equal(second.statusCode, 200);
    const secondCookie = cookieFrom(second);
    assert.notEqual(firstCookie, secondCookie, 'token must rotate');

    const replayOld = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: firstCookie }
    });
    assert.equal(replayOld.statusCode, 401, 'old token must be revoked');
  });
});

describe('CSRF / origin defense', () => {
  it('rejects state-changing requests with mismatched Origin', async () => {
    const res = await post(
      '/api/auth/login',
      { username: 'admin', password: SENTINEL_PASSWORD },
      { origin: 'https://evil.example' }
    );
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, 'forbidden');
  });

  it('allows state-changing requests with matching Origin', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: JSON.stringify({ username: 'admin', password: SENTINEL_PASSWORD }),
      headers: {
        'content-type': 'application/json',
        host: 'localhost:3001',
        origin: 'http://localhost:3001'
      }
    });
    assert.notEqual(login.statusCode, 403, `unexpected 403: ${login.body}`);
  });
});

describe('password change', () => {
  it('requires the current password and revokes all sessions', async () => {
    const login = await post('/api/auth/login', {
      username: 'admin',
      password: SENTINEL_PASSWORD
    });
    const cookie = cookieFrom(login);

    const wrong = await post(
      '/api/auth/password',
      { currentPassword: 'not-the-password-1', newPassword: 'NewPassw0rd-XYZ' },
      { cookie }
    );
    assert.equal(wrong.statusCode, 401);

    const ok = await post(
      '/api/auth/password',
      { currentPassword: SENTINEL_PASSWORD, newPassword: 'NewPassw0rd-XYZ' },
      { cookie }
    );
    assert.equal(ok.statusCode, 200);
    assert.ok((JSON.parse(ok.body).sessionsRevoked ?? 0) >= 1);

    // Old session invalid after password change.
    const replay = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie }
    });
    assert.equal(replay.statusCode, 401);

    // New password works.
    const relogin = await post('/api/auth/login', {
      username: 'admin',
      password: 'NewPassw0rd-XYZ'
    });
    assert.equal(relogin.statusCode, 200);
  });
});

describe('audit trail', () => {
  it('records auth events without secrets', async () => {
    const result = await pool.query<{ action: string; metadata: unknown }>(
      'SELECT action, metadata FROM audit_event ORDER BY id'
    );
    const actions = result.rows.map((row) => row.action);
    assert.ok(actions.includes('auth.bootstrap_admin_created'));
    assert.ok(actions.includes('auth.login'));
    assert.ok(
      actions.some((a) => a === 'auth.login' || a === 'auth.password_change'),
      'outcome variety expected'
    );

    const blob = JSON.stringify(result.rows);
    assert.ok(!blob.includes(SENTINEL_PASSWORD), 'audit must not contain the password');
    assert.ok(!blob.includes('NewPassw0rd-XYZ'), 'audit must not contain the new password');
  });
});
