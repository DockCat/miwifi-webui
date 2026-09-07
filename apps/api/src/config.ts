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
  /**
   * Proxy trust for X-Forwarded-* headers (request.ip, protocol, cookie
   * Secure flag). `true`/`1` trusts every claim (only safe when nothing
   * untrusted can reach the port); a comma-separated CIDR/IP list (e.g.
   * `192.168.155.0/24`) trusts only those peers as proxies, so request.ip
   * resolves to the first hop beyond them — spoofed entries from clients
   * are ignored. `false` (default) ignores forwarded headers entirely.
   */
  readonly trustProxy: boolean | string;
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

function parseBool(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

/**
 * Parse TRUST_PROXY: boolean trust-all, a proxy subnet list, or false.
 * Fastify accepts comma-separated IP/CIDR strings and compiles them via
 * @fastify/proxy-addr — only listed peers are trusted as proxies, which is
 * the safe shape for "API behind the compose/Traefik proxy" deployments.
 */
function parseTrustProxy(value: string | undefined): boolean | string {
  const raw = value?.trim();
  if (raw === undefined || raw === '' || raw === 'false' || raw === '0') return false;
  if (parseBool(raw)) return true;
  // Anything else must look like a proxy address list (IP or CIDR entries).
  if (/^[\d.:a-fA-F/,\s]+$/.test(raw)) {
    const entries = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length > 0) return entries.join(',');
  }
  throw new Error(
    `Invalid TRUST_PROXY value: ${raw}. Use true, false, or a comma-separated proxy IP/CIDR list (e.g. 192.168.155.0/24).`
  );
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
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a postgres:// or postgresql:// connection string');
  }

  return { port, host, databaseUrl, trustProxy };
}
