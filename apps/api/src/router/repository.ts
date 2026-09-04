/**
 * Router persistence: registry, sealed credentials, capability profile.
 *
 * Router passwords are stored only in envelope-sealed form; plaintext lives
 * in memory during login/renewal and nowhere else.
 */
import type pg from 'pg';
import { sealSecret, openSecret } from '../crypto/envelope.js';
import type { RouterCompatibilityStatus, RouterCapability } from '@miwifi-webui/router-core';

export interface RouterRow {
  readonly id: string;
  readonly host: string;
  readonly model: string | null;
  readonly hardware: string | null;
  readonly romVersion: string | null;
  readonly channel: string | null;
  readonly compatibility: RouterCompatibilityStatus;
  readonly capabilities: readonly RouterCapability[];
  readonly lastProbedAt: Date | null;
}

export interface RouterCredentialRow {
  readonly routerId: string;
  readonly username: string;
  readonly sealedPassword: string;
}

export class RouterRepository {
  constructor(private readonly pool: pg.Pool) {}

  async upsertRouter(
    input: {
      host: string;
      model: string | null;
      hardware: string | null;
      romVersion: string | null;
      channel: string | null;
      compatibility: RouterCompatibilityStatus;
      capabilities: readonly RouterCapability[];
    }
  ): Promise<RouterRow> {
    const result = await this.pool.query<RouterRow>(
      `INSERT INTO router
         (host, model, hardware, rom_version, channel, compatibility,
          capabilities, last_probed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
       ON CONFLICT (host) DO UPDATE SET
         model = EXCLUDED.model,
         hardware = EXCLUDED.hardware,
         rom_version = EXCLUDED.rom_version,
         channel = EXCLUDED.channel,
         compatibility = EXCLUDED.compatibility,
         capabilities = EXCLUDED.capabilities,
         last_probed_at = now(),
         updated_at = now()
       RETURNING id, host, model, hardware, rom_version AS "romVersion",
                 channel, compatibility,
                 capabilities AS "capabilities", last_probed_at AS "lastProbedAt"`,
      [
        input.host,
        input.model,
        input.hardware,
        input.romVersion,
        input.channel,
        input.compatibility,
        JSON.stringify(input.capabilities)
      ]
    );
    return result.rows[0]!;
  }

  async listRouters(): Promise<RouterRow[]> {
    const result = await this.pool.query<RouterRow>(
      `SELECT id, host, model, hardware, rom_version AS "romVersion",
              channel, compatibility, capabilities, last_probed_at AS "lastProbedAt"
       FROM router ORDER BY created_at`
    );
    return result.rows;
  }

  async findRouterById(id: string): Promise<RouterRow | null> {
    const result = await this.pool.query<RouterRow>(
      `SELECT id, host, model, hardware, rom_version AS "romVersion",
              channel, compatibility, capabilities, last_probed_at AS "lastProbedAt"
       FROM router WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /** Store the router password sealed under the master key. */
  async saveCredential(
    routerId: string,
    username: string,
    password: string,
    masterKey: string
  ): Promise<void> {
    const sealed = sealSecret(masterKey, password);
    await this.pool.query(
      `INSERT INTO router_credential (router_id, username, sealed_password)
       VALUES ($1, $2, $3)
       ON CONFLICT (router_id) DO UPDATE SET
         username = EXCLUDED.username,
         sealed_password = EXCLUDED.sealed_password,
         updated_at = now()`,
      [routerId, username, sealed]
    );
  }

  /** Load the sealed credential and open it (backend-only). */
  async loadCredential(
    routerId: string,
    masterKey: string
  ): Promise<{ username: string; password: string } | null> {
    const result = await this.pool.query<RouterCredentialRow>(
      `SELECT router_id AS "routerId", username, sealed_password AS "sealedPassword"
       FROM router_credential WHERE router_id = $1`,
      [routerId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      username: row.username,
      password: openSecret(masterKey, row.sealedPassword)
    };
  }

  async deleteRouter(id: string): Promise<void> {
    await this.pool.query('DELETE FROM router WHERE id = $1', [id]);
  }
}
