/**
 * Security hardening tests from the 2026-09-05 review pass.
 *
 * Covers:
 * - M-2: baseline security response headers on API responses;
 * - L-1: login runs Argon2id verification even for unknown users (dummy
 *   hash), so timing does not reveal account existence;
 * - L-6: X-Forwarded-Proto spoofing does not flip cookie Secure unless
 *   the app is explicitly configured with trustProxy.
 *
 * Bootstrap XFF hardening (2026-09-06 review, Vuln 1):
 * - H-1: a spoofed X-Forwarded-For: 127.0.0.1 must NEVER satisfy the
 *   localhost-only bootstrap gate — even with trustProxy enabled (which
 *   makes request.ip header-derived) — because the gate checks the peer
 *   socket address;
 * - H-2: non-loopback clients receive a uniform 403 regardless of whether
 *   the first-run window is open (check order: loopback before user count).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { applyMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '../src/auth/passwords.js';
import type { FastifyInstance } from 'fastify';

const TEST_DB = 'miwifi_headers_test';
const BASE = 'postgres://miwifi:miwifi-dev-password@localhost:5432';
const TEST_URL = `${BASE}/${TEST_DB}`;

let pool: pg.Pool;
let app: FastifyInstance;

before(async () => {
  const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  pool = createPool(TEST_URL);
  await applyMigrations(pool);
  // Direct-access app: trustProxy defaults to false.
  app = await buildApp({ pool });
  await app.ready();
});

after(async () => {
  await app?.close();
  await pool?.end();
  const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();
});

describe('M-2: security response headers', () => {
  it('sets nosniff, frame denial, referrer policy, and a closed CSP on API responses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    const csp = res.headers['content-security-policy'];
    assert.ok(typeof csp === 'string' && csp.includes("default-src 'none'"));
    assert.ok(typeof csp === 'string' && csp.includes("frame-ancestors 'none'"));
  });
});

describe('L-1: login timing equalization', () => {
  it('DUMMY_PASSWORD_HASH parses and fails verification at full cost', async () => {
    // Must be a well-formed Argon2id hash with the project parameters:
    // otherwise the login path would shortcut and reintroduce the timing gap.
    assert.match(DUMMY_PASSWORD_HASH, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.equal(await verifyPassword('any-password', DUMMY_PASSWORD_HASH), false);
  });

  it('login with an unknown username costs a real verification (generic 401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: JSON.stringify({ username: 'no-such-user', password: 'whatever-12345' }),
      headers: { 'content-type': 'application/json' }
    });
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error, 'invalid_credentials');
  });
});

describe('L-6: forwarded-header spoofing without trustProxy', () => {
  it('a client-supplied X-Forwarded-Proto: https does not mark the session cookie Secure', async () => {
    // Bootstrap from loopback (light-my-request remoteAddress is 127.0.0.1)
    // with a spoofed forwarded-proto header; the app has trustProxy=false,
    // so the header must be ignored for cookie decisions.
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      payload: JSON.stringify({ username: 'admin', password: 'bootstrap-pass-123' }),
      headers: {
        'content-type': 'application/json',
        'x-forwarded-proto': 'https'
      }
    });
    assert.equal(res.statusCode, 201, `body: ${res.body}`);
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(typeof raw === 'string');
    // Secure must NOT appear: the request was plain HTTP behind no trusted
    // proxy; a spoofed header must not create a Secure cookie the browser
    // would then refuse over HTTP.
    assert.ok(!/secure/i.test(raw), 'cookie must not be Secure when proxy is untrusted');
    assert.match(raw, /httponly/i);
    assert.match(raw, /samesite=lax/i);
  });
});

describe('H-1: bootstrap loopback gate vs X-Forwarded-For spoofing', () => {
  // The admin user created by the L-6 test above makes the bootstrap
  // window closed; a fresh database is needed for the positive path.
  let freshPool: pg.Pool;
  let freshApp: FastifyInstance;

  before(async () => {
    const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}_h1`);
    await admin.query(`CREATE DATABASE ${TEST_DB}_h1`);
    await admin.end();
    freshPool = createPool(`${BASE}/${TEST_DB}_h1`);
    await applyMigrations(freshPool);
  });

  after(async () => {
    await freshApp?.close();
    await freshPool?.end();
    const admin = new pg.Pool({ connectionString: `${BASE}/miwifi` });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}_h1`);
    await admin.end();
  });

  it('a spoofed X-Forwarded-For: 127.0.0.1 is rejected even with trustProxy: true', async () => {
    // trustProxy: true makes request.ip fully header-derived (leftmost XFF
    // entry) — historically the hardest configuration. The bootstrap gate
    // must still reject: it checks the peer socket address, not request.ip.
    // light-my-request's peer socket is 127.0.0.1, so to make the socket
    // genuinely non-loopback we verify the negative space differently:
    // the gate must consult the socket, so we assert the header alone never
    // changes the outcome for a request whose socket is loopback either way.
    // The real attack (LAN socket + spoofed header) is covered by the
    // direct-socket test below via app.inject's remoteAddress option.
    freshApp = await buildApp({ pool: freshPool, trustProxy: true });
    await freshApp.ready();

    // inject supports remoteAddress — simulate the attacker: a NON-loopback
    // peer socket sending a spoofed loopback XFF entry.
    const res = await freshApp.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      remoteAddress: '192.168.1.50',
      payload: JSON.stringify({ username: 'attacker', password: 'attacker-pass-123' }),
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '127.0.0.1'
      }
    });
    assert.equal(
      res.statusCode,
      403,
      `spoofed XFF must not satisfy the loopback gate (got ${res.statusCode}: ${res.body})`
    );
    assert.equal(JSON.parse(res.body).error, 'bootstrap_local_only');
  });

  it('a genuine loopback socket still bootstraps (positive path, headers ignored)', async () => {
    // Same app (trustProxy: true), now from a real loopback peer socket.
    // The user table is still empty: the previous request was rejected.
    const res = await freshApp.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      remoteAddress: '127.0.0.1',
      payload: JSON.stringify({ username: 'owner', password: 'owner-pass-123' }),
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9'
      }
    });
    assert.equal(res.statusCode, 201, `body: ${res.body}`);
    assert.equal(JSON.parse(res.body).status, 'created');
  });

  it('non-loopback clients get a uniform 403 whether or not an admin exists', async () => {
    // Check order: loopback before user count. The admin now exists (created
    // above), yet a non-loopback client must still see 403 — NOT 409 — so the
    // response discloses nothing about first-run state.
    const res = await freshApp.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      remoteAddress: '192.168.1.50',
      payload: JSON.stringify({ username: 'x', password: 'whatever-12345' }),
      headers: { 'content-type': 'application/json' }
    });
    assert.equal(res.statusCode, 403, 'must be 403 (not 409) for non-loopback');
    assert.equal(JSON.parse(res.body).error, 'bootstrap_local_only');
  });
});
