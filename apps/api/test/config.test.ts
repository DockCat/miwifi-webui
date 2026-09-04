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
});

afterEach(() => {
  for (const key of ['DATABASE_URL', 'API_PORT', 'API_HOST']) {
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
});
