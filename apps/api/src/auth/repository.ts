/**
 * User + session persistence.
 *
 * All SQL lives here; routes never assemble queries. Session tokens are
 * stored only as sha256 hashes.
 */
import type pg from 'pg';
import { hashSessionToken } from './tokens.js';

export interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  passwordChangedAt: Date;
}

export interface SessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // ~30 minutes
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // ~12 hours

export class AuthRepository {
  constructor(private readonly pool: pg.Pool) {}

  async userCount(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT count(*)::int AS count FROM app_user'
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async createUser(username: string, passwordHash: string): Promise<UserRow> {
    const result = await this.pool.query<UserRow>(
      `INSERT INTO app_user (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, password_hash AS "passwordHash",
                 password_changed_at AS "passwordChangedAt"`,
      [username, passwordHash]
    );
    return result.rows[0]!;
  }

  async findUserByUsername(username: string): Promise<UserRow | null> {
    const result = await this.pool.query<UserRow>(
      `SELECT id, username, password_hash AS "passwordHash",
              password_changed_at AS "passwordChangedAt"
       FROM app_user WHERE username = $1`,
      [username]
    );
    return result.rows[0] ?? null;
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const result = await this.pool.query<UserRow>(
      `SELECT id, username, password_hash AS "passwordHash",
              password_changed_at AS "passwordChangedAt"
       FROM app_user WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async updateUserPassword(
    userId: string,
    passwordHash: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE app_user
       SET password_hash = $2, password_changed_at = now(), updated_at = now()
       WHERE id = $1`,
      [userId, passwordHash]
    );
  }

  async createSession(
    userId: string,
    rawToken: string,
    rotatedFrom: string | null
  ): Promise<SessionRow> {
    const result = await this.pool.query<SessionRow>(
      `INSERT INTO app_session
         (user_id, token_hash, idle_expires_at, absolute_expires_at, rotated_from)
       VALUES ($1, $2, now() + $3::interval, now() + $4::interval, $5)
       RETURNING id, user_id AS "userId", created_at AS "createdAt",
                 last_seen_at AS "lastSeenAt",
                 idle_expires_at AS "idleExpiresAt",
                 absolute_expires_at AS "absoluteExpiresAt",
                 revoked_at AS "revokedAt"`,
      [
        userId,
        hashSessionToken(rawToken),
        `${IDLE_TIMEOUT_MS / 1000} seconds`,
        `${ABSOLUTE_TIMEOUT_MS / 1000} seconds`,
        rotatedFrom
      ]
    );
    return result.rows[0]!;
  }

  /** Valid (unrevoked, unexpired) session for a raw token, or null. */
  async findValidSession(rawToken: string): Promise<SessionRow | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, user_id AS "userId", created_at AS "createdAt",
              last_seen_at AS "lastSeenAt",
              idle_expires_at AS "idleExpiresAt",
              absolute_expires_at AS "absoluteExpiresAt",
              revoked_at AS "revokedAt"
       FROM app_session
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND idle_expires_at > now()
         AND absolute_expires_at > now()`,
      [hashSessionToken(rawToken)]
    );
    return result.rows[0] ?? null;
  }

  async touchSession(sessionId: string): Promise<void> {
    // Sliding idle window: bumped on authenticated activity. Idle expiry
    // never extends past the absolute deadline.
    await this.pool.query(
      `UPDATE app_session
       SET last_seen_at = now(),
           idle_expires_at = LEAST(now() + $2::interval, absolute_expires_at)
       WHERE id = $1`,
      [sessionId, `${IDLE_TIMEOUT_MS / 1000} seconds`]
    );
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.pool.query(
      'UPDATE app_session SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [sessionId]
    );
  }

  async revokeAllSessionsForUser(userId: string): Promise<number> {
    const result = await this.pool.query(
      'UPDATE app_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
    return result.rowCount ?? 0;
  }
}
