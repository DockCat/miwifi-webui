/**
 * PostgreSQL connectivity foundation.
 *
 * Bootstrap scope: a connection pool and readiness ping only. No schema,
 * no repositories — those arrive with their own tasks and migrations.
 */
import pg from 'pg';

export interface DbCheckResult {
  ok: boolean;
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    // Small bootstrap pool: this service currently has near-zero query load.
    max: 5,
    idleTimeoutMillis: 30_000,
    // Fail fast when the database is not reachable, so /api/ready reflects
    // reality rather than hanging.
    connectionTimeoutMillis: 3_000
  });
}

export async function checkDatabase(pool: pg.Pool): Promise<DbCheckResult> {
  try {
    await pool.query('SELECT 1');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function closePool(pool: pg.Pool): Promise<void> {
  await pool.end().catch(() => {
    // Shutdown must never hang on a database that is already gone.
  });
}
