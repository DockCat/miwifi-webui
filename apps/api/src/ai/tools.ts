/**
 * AI investigation tools (Task 0007) — read-only by construction.
 *
 * Every tool: explicit input schema, explicit output shape, bounded time
 * range and result count, no credential fields, no unrestricted database
 * access (each tool issues fixed, parameterized queries only). The
 * registry is the ONLY surface an AI provider can call; mutation tools
 * cannot exist here — there is no write tool at all.
 */
import type pg from 'pg';

export interface ToolContext {
  readonly pool: pg.Pool;
  readonly routerId: string;
}

export interface ToolDefinition<I, O> {
  readonly name: string;
  readonly description: string;
  /** Structural input validation (bounds enforced here). */
  readonly validate: (input: unknown) => I | null;
  readonly execute: (ctx: ToolContext, input: I) => Promise<O>;
}

const MAX_LIMIT = 50;
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function boundedLimit(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) return null;
  return value;
}

function boundedSince(raw: unknown): Date | null {
  const date = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(date.getTime())) return null;
  const age = Date.now() - date.getTime();
  if (age < 0 || age > MAX_WINDOW_MS) return null;
  return date;
}

// --- Tool: router status (recent telemetry) ---

export interface RouterStatusInput {
  readonly limit: number;
}
export interface RouterStatusOutput {
  readonly snapshots: ReadonlyArray<{
    id: string;
    capturedAt: string;
    payload: Record<string, unknown>;
  }>;
}

export const routerStatusTool: ToolDefinition<RouterStatusInput, RouterStatusOutput> = {
  name: 'router_status',
  description: 'Recent telemetry snapshots for router health (cpu, memory, wan).',
  validate: (input) => {
    if (typeof input !== 'object' || input === null) return null;
    const limit = boundedLimit((input as { limit?: unknown }).limit ?? 10);
    if (limit === null) return null;
    return { limit };
  },
  execute: async (ctx, input) => {
    const result = await ctx.pool.query(
      `SELECT id::text AS id, captured_at AS "capturedAt", payload
       FROM telemetry_snapshot
       WHERE router_id = $1
       ORDER BY captured_at DESC LIMIT $2`,
      [ctx.routerId, input.limit]
    );
    return {
      snapshots: result.rows.map((row: { id: string; capturedAt: Date; payload: Record<string, unknown> }) => ({
        id: row.id,
        capturedAt: new Date(row.capturedAt).toISOString(),
        payload: row.payload
      }))
    };
  }
};

// --- Tool: device state ---

export interface DeviceStateInput {
  readonly limit: number;
}
export interface DeviceStateOutput {
  readonly devices: ReadonlyArray<{
    id: string;
    name: string | null;
    online: boolean;
    internetAccess: boolean;
    lastSeenAt: string;
  }>;
}

export const deviceStateTool: ToolDefinition<DeviceStateInput, DeviceStateOutput> = {
  name: 'device_state',
  description: 'Current device list with online state and last-seen times.',
  validate: (input) => {
    if (typeof input !== 'object' || input === null) return null;
    const limit = boundedLimit((input as { limit?: unknown }).limit ?? 50);
    if (limit === null) return null;
    return { limit };
  },
  execute: async (ctx, input) => {
    const result = await ctx.pool.query(
      `SELECT id::text AS id, name, online, internet_access AS "internetAccess",
              last_seen_at AS "lastSeenAt"
       FROM device WHERE router_id = $1 ORDER BY online DESC, name LIMIT $2`,
      [ctx.routerId, input.limit]
    );
    return {
      devices: result.rows.map((row: { id: string; name: string | null; online: boolean; internetAccess: boolean; lastSeenAt: Date }) => ({
        id: row.id,
        name: row.name,
        online: row.online,
        internetAccess: row.internetAccess,
        lastSeenAt: new Date(row.lastSeenAt).toISOString()
      }))
    };
  }
};

// --- Tool: presence history ---

export interface PresenceHistoryInput {
  readonly since: Date;
  readonly limit: number;
}
export interface PresenceHistoryOutput {
  readonly events: ReadonlyArray<{
    id: string;
    deviceId: string;
    kind: string;
    occurredAt: string;
  }>;
}

export const presenceHistoryTool: ToolDefinition<PresenceHistoryInput, PresenceHistoryOutput> = {
  name: 'presence_history',
  description: 'Device online/offline transitions since a timestamp (max 30 days back).',
  validate: (input) => {
    if (typeof input !== 'object' || input === null) return null;
    const since = boundedSince((input as { since?: unknown }).since);
    const limit = boundedLimit((input as { limit?: unknown }).limit ?? 50);
    if (since === null || limit === null) return null;
    return { since, limit };
  },
  execute: async (ctx, input) => {
    const result = await ctx.pool.query(
      `SELECT id::text AS id, device_id::text AS "deviceId", kind,
              occurred_at AS "occurredAt"
       FROM device_presence_event
       WHERE router_id = $1 AND occurred_at >= $2
       ORDER BY occurred_at DESC LIMIT $3`,
      [ctx.routerId, input.since.toISOString(), input.limit]
    );
    return {
      events: result.rows.map((row: { id: string; deviceId: string; kind: string; occurredAt: Date }) => ({
        id: row.id,
        deviceId: row.deviceId,
        kind: row.kind,
        occurredAt: new Date(row.occurredAt).toISOString()
      }))
    };
  }
};

// --- Tool: audit history (read-only view) ---

export interface AuditHistoryInput {
  readonly since: Date;
  readonly limit: number;
}
export interface AuditHistoryOutput {
  readonly events: ReadonlyArray<{
    id: string;
    action: string;
    outcome: string;
    occurredAt: string;
  }>;
}

export const auditHistoryTool: ToolDefinition<AuditHistoryInput, AuditHistoryOutput> = {
  name: 'audit_history',
  description: 'Application audit events since a timestamp (max 30 days back).',
  validate: (input) => {
    if (typeof input !== 'object' || input === null) return null;
    const since = boundedSince((input as { since?: unknown }).since);
    const limit = boundedLimit((input as { limit?: unknown }).limit ?? 50);
    if (since === null || limit === null) return null;
    return { since, limit };
  },
  execute: async (ctx, input) => {
    const result = await ctx.pool.query(
      `SELECT id::text AS id, action, outcome, occurred_at AS "occurredAt"
       FROM audit_event
       WHERE occurred_at >= $1 ORDER BY occurred_at DESC LIMIT $2`,
      [input.since.toISOString(), input.limit]
    );
    return {
      events: result.rows.map((row: { id: string; action: string; outcome: string; occurredAt: Date }) => ({
        id: row.id,
        action: row.action,
        outcome: row.outcome,
        occurredAt: new Date(row.occurredAt).toISOString()
      }))
    };
  }
};

// --- Tool: evidence lookup ---

export interface EvidenceLookupInput {
  readonly evidenceKind: 'telemetry_snapshot' | 'presence_event' | 'device' | 'audit_event';
  readonly evidenceId: string;
}
export interface EvidenceLookupOutput {
  readonly found: boolean;
  readonly summary: string | null;
}

export const evidenceLookupTool: ToolDefinition<EvidenceLookupInput, EvidenceLookupOutput> = {
  name: 'evidence_lookup',
  description: 'Fetch one local evidence record by kind and id to ground a finding.',
  validate: (input) => {
    if (typeof input !== 'object' || input === null) return null;
    const kind = (input as { evidenceKind?: unknown }).evidenceKind;
    const id = (input as { evidenceId?: unknown }).evidenceId;
    if (
      kind !== 'telemetry_snapshot' &&
      kind !== 'presence_event' &&
      kind !== 'device' &&
      kind !== 'audit_event'
    ) {
      return null;
    }
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
    return { evidenceKind: kind, evidenceId: id };
  },
  execute: async (ctx, input) => {
    switch (input.evidenceKind) {
      case 'telemetry_snapshot': {
        const result = await ctx.pool.query(
          'SELECT captured_at AS "capturedAt", payload FROM telemetry_snapshot WHERE id = $1::bigint AND router_id = $2',
          [input.evidenceId, ctx.routerId]
        );
        const row = result.rows[0] as { capturedAt: Date; payload: unknown } | undefined;
        return {
          found: Boolean(row),
          summary: row ? `telemetry at ${new Date(row.capturedAt).toISOString()}: ${JSON.stringify(row.payload).slice(0, 400)}` : null
        };
      }
      case 'presence_event': {
        const result = await ctx.pool.query(
          'SELECT kind, occurred_at AS "occurredAt", device_id::text AS "deviceId" FROM device_presence_event WHERE id = $1::bigint AND router_id = $2',
          [input.evidenceId, ctx.routerId]
        );
        const row = result.rows[0] as { kind: string; occurredAt: Date; deviceId: string } | undefined;
        return {
          found: Boolean(row),
          summary: row ? `presence ${row.kind} for device ${row.deviceId.slice(0, 8)} at ${new Date(row.occurredAt).toISOString()}` : null
        };
      }
      case 'device': {
        const result = await ctx.pool.query(
          'SELECT name, mac, online FROM device WHERE id = $1::uuid AND router_id = $2',
          [input.evidenceId, ctx.routerId]
        );
        const row = result.rows[0] as { name: string | null; mac: string | null; online: boolean } | undefined;
        return {
          found: Boolean(row),
          summary: row ? `device ${row.name ?? row.mac ?? input.evidenceId.slice(0, 8)} online=${row.online}` : null
        };
      }
      case 'audit_event': {
        const result = await ctx.pool.query(
          'SELECT action, outcome, occurred_at AS "occurredAt" FROM audit_event WHERE id = $1::bigint',
          [input.evidenceId]
        );
        const row = result.rows[0] as { action: string; outcome: string; occurredAt: Date } | undefined;
        return {
          found: Boolean(row),
          summary: row ? `audit ${row.action} (${row.outcome}) at ${new Date(row.occurredAt).toISOString()}` : null
        };
      }
    }
  }
};

/** The complete tool registry an AI provider can invoke. READ-ONLY ONLY. */
export const INVESTIGATION_TOOLS = [
  routerStatusTool,
  deviceStateTool,
  presenceHistoryTool,
  auditHistoryTool,
  evidenceLookupTool
] as const;

export type ToolName = (typeof INVESTIGATION_TOOLS)[number]['name'];

export function runTool(
  ctx: ToolContext,
  name: string,
  input: unknown
): Promise<unknown> | null {
  for (const tool of INVESTIGATION_TOOLS) {
    if (tool.name === name) {
      const loose = tool as unknown as ToolDefinition<unknown, unknown>;
      const validated = loose.validate(input);
      if (validated === null) return null;
      return loose.execute(ctx, validated);
    }
  }
  return null;
}
