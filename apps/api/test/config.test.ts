/**
 * Config boundary tests: required variables, validation, safe errors.
 *
 * dotenv loading is disabled so tests exercise the environment variables
 * directly instead of picking up the developer's local .env.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { loadConfig } from '../src/config.js';
import process from 'node:process';

const originalEnv = { ...process.env };

function withEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  delete process.env.API_PORT;
  delete process.env.API_HOST;
  delete process.env.DATABASE_URL;
  delete process.env.POLLING_STATUS_INTERVAL_MS;
  delete process.env.POLLING_INVENTORY_INTERVAL_MS;
  delete process.env.POLLING_TELEMETRY_INTERVAL_MS;
});

afterEach(() => {
  for (const key of [
    'DATABASE_URL',
    'API_PORT',
    'API_HOST',
    'POLLING_STATUS_INTERVAL_MS',
    'POLLING_INVENTORY_INTERVAL_MS',
    'POLLING_TELEMETRY_INTERVAL_MS'
  ]) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('loadConfig', () => {
  it('loads defaults and required DATABASE_URL', () => {
    withEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' });
    const config = loadConfig({ dotenv: false });
    assert.equal(config.port, 3001);
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.databaseUrl, 'postgres://u:p@localhost:5432/db');
  });

  it('rejects missing DATABASE_URL', () => {
    withEnv({ DATABASE_URL: undefined });
    assert.throws(
      () => loadConfig({ dotenv: false }),
      /Missing required environment variable: DATABASE_URL/
    );
  });

  it('rejects empty DATABASE_URL', () => {
    withEnv({ DATABASE_URL: '   ' });
    assert.throws(
      () => loadConfig({ dotenv: false }),
      /Missing required environment variable/
    );
  });

  it('rejects non-postgres DATABASE_URL', () => {
    withEnv({ DATABASE_URL: 'mysql://u:p@localhost/db' });
    assert.throws(() => loadConfig({ dotenv: false }), /postgres/);
  });

  it('rejects invalid ports', () => {
    withEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/db', API_PORT: 'not-a-number' });
    assert.throws(() => loadConfig({ dotenv: false }), /Invalid port/);
    withEnv({ API_PORT: '70000' });
    assert.throws(() => loadConfig({ dotenv: false }), /Invalid port/);
    withEnv({ API_PORT: '0' });
    assert.throws(() => loadConfig({ dotenv: false }), /Invalid port/);
  });

  it('accepts explicit port and host', () => {
    withEnv({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      API_PORT: '8080',
      API_HOST: '0.0.0.0'
    });
    const config = loadConfig({ dotenv: false });
    assert.equal(config.port, 8080);
    assert.equal(config.host, '0.0.0.0');
  });

  it('loads default polling intervals', () => {
    withEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' });
    const config = loadConfig({ dotenv: false });
    assert.equal(config.polling.statusIntervalMs, 15_000);
    assert.equal(config.polling.inventoryIntervalMs, 60_000);
    assert.equal(config.polling.telemetryIntervalMs, 60_000);
  });

  it('accepts explicit polling intervals', () => {
    withEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      POLLING_STATUS_INTERVAL_MS: '20000',
      POLLING_INVENTORY_INTERVAL_MS: '45000',
      POLLING_TELEMETRY_INTERVAL_MS: '120000'
    });
    const config = loadConfig({ dotenv: false });
    assert.equal(config.polling.statusIntervalMs, 20_000);
    assert.equal(config.polling.inventoryIntervalMs, 45_000);
    assert.equal(config.polling.telemetryIntervalMs, 120_000);
  });

  it('rejects invalid polling intervals', () => {
    withEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      POLLING_STATUS_INTERVAL_MS: '500' // < 1000ms
    });
    assert.throws(
      () => loadConfig({ dotenv: false }),
      /Invalid POLLING_STATUS_INTERVAL_MS value: 500. Must be an integer between 1000 and 2147483647 ms./
    );

    withEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      POLLING_STATUS_INTERVAL_MS: '3000000000' // > 2^31 - 1
    });
    assert.throws(
      () => loadConfig({ dotenv: false }),
      /Invalid POLLING_STATUS_INTERVAL_MS value: 3000000000. Must be an integer between 1000 and 2147483647 ms./
    );

    withEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      POLLING_STATUS_INTERVAL_MS: undefined,
      POLLING_INVENTORY_INTERVAL_MS: 'abc'
    });
    assert.throws(
      () => loadConfig({ dotenv: false }),
      /Invalid POLLING_INVENTORY_INTERVAL_MS value/
    );
  });
});
