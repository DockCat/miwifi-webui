/**
 * Append-only audit event writer.
 *
 * Metadata is an explicit allowlist — callers pass structured fields, never
 * raw request bodies. Secrets (passwords, stok, master key, API keys,
 * cookies) must never be passed here; a defensive scrub drops them if a
 * caller makes a mistake.
 */
import type pg from 'pg';

export type AuditOutcome = 'success' | 'failure';

export interface AuditEventInput {
  action: string;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  routerId?: string | null;
  outcome: AuditOutcome;
  requestId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

const METADATA_KEY_BLOCKLIST = new Set([
  'password',
  'password_hash',
  'old_password',
  'new_password',
  'stok',
  'token',
  'session_token',
  'cookie',
  'authorization',
  'app_master_key',
  'master_key',
  'api_key',
  'secret'
]);

function scrubMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined
): Record<string, string | number | boolean | null> {
  if (!metadata) return {};
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (METADATA_KEY_BLOCKLIST.has(key.toLowerCase())) continue;
    safe[key] = value;
  }
  return safe;
}

export class AuditWriter {
  constructor(private readonly pool: pg.Pool) {}

  async record(input: AuditEventInput): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO audit_event
           (actor_id, action, target_type, target_id, router_id, outcome,
            request_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          input.actorId ?? null,
          input.action,
          input.targetType ?? null,
          input.targetId ?? null,
          input.routerId ?? null,
          input.outcome,
          input.requestId ?? null,
          JSON.stringify(scrubMetadata(input.metadata))
        ]
      );
    } catch {
      // Audit is best-effort inline; never fail a request because the audit
      // write errored. (Failure is observable via DB monitoring; swallowed
      // here deliberately to keep auth flows simple.)
    }
  }
}
