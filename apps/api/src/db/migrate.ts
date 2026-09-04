/**
 * Minimal migration runner.
 *
 * Applies committed SQL files under src/db/migrations in filename order,
 * exactly once, tracked in a `_migrations` bookkeeping table. Re-running is
 * a no-op for already-applied migrations.
 *
 * Deliberately dependency-free: the ORM/query-builder choice is unresolved,
 * and bootstrap only needs repeatable schema state management.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations'
);

export interface MigrationRecord {
  readonly name: string;
  readonly appliedAt: Date;
}

async function ensureBookkeepingTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function listMigrationFiles(): Promise<string[]> {
  try {
    const entries = await readdir(MIGRATIONS_DIR);
    return entries
      .filter((name) => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    // No migrations directory yet — nothing to apply.
    return [];
  }
}

export async function applyMigrations(pool: pg.Pool): Promise<string[]> {
  const files = await listMigrationFiles();
  const applied: string[] = [];

  const client = await pool.connect();
  try {
    await ensureBookkeepingTable(client);

    const existing = new Set(
      (await client.query<{ name: string }>(
        'SELECT name FROM _migrations'
      )).rows.map((row) => row.name)
    );

    for (const file of files) {
      if (existing.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      // One migration = one transaction; a failed migration rolls back and
      // the runner stops with the error surfaced.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  } finally {
    client.release();
  }

  return applied;
}

export async function listAppliedMigrations(pool: pg.Pool): Promise<MigrationRecord[]> {
  const client = await pool.connect();
  try {
    await ensureBookkeepingTable(client);
    const result = await client.query<{ name: string; applied_at: Date }>(
      'SELECT name, applied_at FROM _migrations ORDER BY name'
    );
    return result.rows.map((row) => ({
      name: row.name,
      appliedAt: new Date(row.applied_at)
    }));
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const { loadConfig } = await import('../config.js');
  const { createPool, closePool } = await import('./pool.js');

  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    const applied = await applyMigrations(pool);
    if (applied.length === 0) {
      console.log('No new migrations to apply.');
    } else {
      for (const name of applied) {
        console.log(`Applied: ${name}`);
      }
    }
    const all = await listAppliedMigrations(pool);
    console.log(`Applied migrations on record: ${all.length}`);
  } finally {
    await closePool(pool);
  }
}

// CLI entrypoint: `pnpm db:migrate` executes this module directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
