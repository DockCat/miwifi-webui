/**
 * Central, validated environment configuration boundary.
 *
 * All environment parsing happens here — application code must never read
 * process.env ad hoc. Only values actually used by the bootstrap are
 * required; no fake secrets for unimplemented features.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export interface AppConfig {
  readonly port: number;
  readonly host: string;
  readonly databaseUrl: string;
}

/**
 * Load the workspace `.env` if present.
 *
 * Walks up from the current working directory so commands work both from the
 * repo root and from apps/api. Real environment variables still win — the
 * file is a development convenience, not the source of truth in deployment.
 */
function loadDotEnv(): void {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        // Malformed .env: let explicit env vars carry the run; do not crash
        // the whole process over a dev convenience file.
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and adjust values.`
    );
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  return value;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port value: ${value}`);
  }
  return port;
}

export interface LoadConfigOptions {
  /**
   * Load a `.env` file when explicit environment variables are missing.
   * Default: true in normal operation; tests disable it for isolation.
   */
  readonly dotenv?: boolean;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  if (options.dotenv !== false) {
    loadDotEnv();
  }

  const port = parsePort(optionalEnv('API_PORT', '3001'));
  const host = optionalEnv('API_HOST', '127.0.0.1');
  const databaseUrl = requireEnv('DATABASE_URL');

  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a postgres:// or postgresql:// connection string');
  }

  return { port, host, databaseUrl };
}
