/**
 * AI investigation tools (Task 0007; extended in Task 0011) — read-only by
 * construction.
 *
 * Every tool: explicit input schema, explicit output shape, bounded time
 * range and result count, no credential fields, no unrestricted database
 * access (each tool issues fixed, parameterized queries only). The
 * registry is the ONLY surface an AI provider can call; mutation tools
 * cannot exist here — there is no write tool at all.
 *
 * Name pseudonymization happens at this output layer (the primary
 * defense): in external mode a tool NEVER emits a raw device name. MAC/IP
 * get a second layer downstream in
 * pseudonymize() and are never emitted raw by any tool.
 *
 * Live per-device rates live only in the scheduler's in-memory map (they
 * are not persisted), so tools accept an optional scheduler handle; when
 * absent (tests), live fields degrade to zeros/'unknown'.
 */
import type pg from 'pg';
import { deviceNameFor, type AliasMap, type PrivacyConfig } from './privacy.js';
import type { PollingScheduler } from '../observability/scheduler.js';
import type { NormalizedDevice } from '@miwifi-webui/router-core';

export interface ToolContext {
  readonly pool: pg.Pool;
  readonly routerId: string;
  /** Egress privacy for this investigation (derived from provider mode). */
  readonly privacy: PrivacyConfig;
  /** Shared per-investigation alias map (question + all tool calls). */
  readonly aliases: AliasMap;
  /** Live in-memory observations (rates/totals live only here); optional. */
  readonly scheduler?: PollingScheduler;
}

/** What callers supply: runInvestigation fills in privacy + aliases. */
export type ToolContextBase = Omit<ToolContext, 'privacy' | 'aliases'>;

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

/**
 * Live device observation from the scheduler's in-memory map (keyed by
 * mac/ip like the /devices route merges it). Absent scheduler or missing
 * entry yields zeros/'unknown' — the same fallback the REST endpoint uses.
 */
function liveDeviceEntry(
  ctx: ToolContext,
  mac: string | null,
  ip: string | null
): Partial<NormalizedDevice> {
  const map = ctx.scheduler?.getLatestDevices(ctx.routerId) ?? null;
  if (!map) return {};
  const latest =
    (mac ? map.get(`mac:${mac}`) : undefined) ??
    (ip ? map.get(`ip:${ip}`) : undefined);
  return latest ?? {};
}

/** Explicit numeric/boolean telemetry projection; never serialize arbitrary payloads. */
function safeTelemetry(payload: Record<string, unknown>): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  if (payload === null || typeof payload !== 'object') return out;
  for (const key of ['cpuLoad', 'memUsed', 'memTotal', 'temperature', 'wanUp',
    'wanDownspeed', 'wanUpspeed', 'wanDownloadTotal', 'wanUploadTotal', 'upTimeSeconds', 'deviceCount']) {
    const value = payload[key];
    if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') out[key] = value;
  }
  return out;
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
        payload: safeTelemetry(row.payload)
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
    downspeed: number;
    upspeed: number;
    downloadTotal: number;
    uploadTotal: number;
    connectionType: string;
  }>;
}

export const deviceStateTool: ToolDefinition<DeviceStateInput, DeviceStateOutput> = {
  name: 'device_state',
  description:
    'Current device list with online state, last-seen times, live down/up rates, cumulative traffic totals, and connection type (wired / wifi_2g / wifi_5g / guest / unknown).',
  validate: (input) => {
    if (typeof input !== 'object' || input === null) return null;
    const limit = boundedLimit((input as { limit?: unknown }).limit ?? 50);
    if (limit === null) return null;
    return { limit };
  },
  execute: async (ctx, input) => {
    const result = await ctx.pool.query(
      `SELECT id::text AS id, name, mac, ip, online, internet_access AS "internetAccess",
              last_seen_at AS "lastSeenAt"
       FROM device WHERE router_id = $1 ORDER BY online DESC, name LIMIT $2`,
      [ctx.routerId, input.limit]
    );
    return {
      devices: result.rows.map(
        (row: {
          id: string;
          name: string | null;
          mac: string | null;
          ip: string | null;
          online: boolean;
          internetAccess: boolean;
          lastSeenAt: Date;
        }) => {
          const live = liveDeviceEntry(ctx, row.mac, row.ip);
          return {
            id: row.id,
            // External mode never emits raw names here (primary defense).
            name: deviceNameFor(row.name, row.id, ctx.privacy, ctx.aliases),
            online: row.online,
            internetAccess: row.internetAccess,
            lastSeenAt: new Date(row.lastSeenAt).toISOString(),
            downspeed: live.downspeed ?? 0,
            upspeed: live.upspeed ?? 0,
            downloadTotal: live.downloadTotal ?? 0,
            uploadTotal: live.uploadTotal ?? 0,
            connectionType: live.connectionType ?? 'unknown'
          };
        }
      )
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
    deviceName: string | null;
    kind: string;
    occurredAt: string;
  }>;
}

export const presenceHistoryTool: ToolDefinition<PresenceHistoryInput, PresenceHistoryOutput> = {
  name: 'presence_history',
  description: 'Device online/offline transitions since a timestamp (max 30 days back), with device names.',
  validate: (input) => {
    if (typeof input !== 'object' || input === null) return null;
    const since = boundedSince((input as { since?: unknown }).since);
    const limit = boundedLimit((input as { limit?: unknown }).limit ?? 50);
    if (since === null || limit === null) return null;
    return { since, limit };
  },
  execute: async (ctx, input) => {
    const result = await ctx.pool.query(
      `SELECT p.id::text AS id, p.device_id::text AS "deviceId",
              d.name AS "deviceName", d.id::text AS "deviceIdFallback",
              p.kind, p.occurred_at AS "occurredAt"
       FROM device_presence_event p
       LEFT JOIN device d ON d.id = p.device_id
       WHERE p.router_id = $1 AND p.occurred_at >= $2
       ORDER BY p.occurred_at DESC LIMIT $3`,
      [ctx.routerId, input.since.toISOString(), input.limit]
    );
    return {
      events: result.rows.map(
        (row: {
          id: string;
          deviceId: string;
          deviceName: string | null;
          deviceIdFallback: string;
          kind: string;
          occurredAt: Date;
        }) => ({
          id: row.id,
          deviceId: row.deviceId,
          deviceName: deviceNameFor(row.deviceName, row.deviceIdFallback, ctx.privacy, ctx.aliases),
          kind: row.kind,
          occurredAt: new Date(row.occurredAt).toISOString()
        })
      )
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
       WHERE (router_id = $1 OR router_id IS NULL) AND occurred_at >= $2
       ORDER BY occurred_at DESC LIMIT $3`,
      [ctx.routerId, input.since.toISOString(), input.limit]
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

// --- Tool: telemetry timeseries (dashboard throughput chart data) ---

export interface TelemetryTimeseriesInput {
  readonly range: '1d' | '1w' | '1m';
}
export interface TelemetryTimeseriesOutput {
  readonly points: ReadonlyArray<{
    timestamp: string;
    downspeed: number;
    upspeed: number;
    deviceCount: number;
    cpuLoad: number;
    memUsed: number;
    temperature: number | null;
  }>;
}

/** Bucket width + window per range, mirroring the dashboard chart. */
const RANGE_PARAMS: Record<'1d' | '1w' | '1m', { bucketSeconds: number; interval: string }> = {
  '1d': { bucketSeconds: 300, interval: '24 hours' },
  '1w': { bucketSeconds: 3600, interval: '7 days' },
  '1m': { bucketSeconds: 21600, interval: '30 days' }
};

export const telemetryTimeseriesTool: ToolDefinition<
  TelemetryTimeseriesInput,
  TelemetryTimeseriesOutput
> = {
  name: 'telemetry_timeseries',
  description:
    'Aggregated WAN throughput, device count, CPU, memory, and temperature buckets over time — the same data as the dashboard throughput chart. Range: 1d (5-min buckets over 24h), 1w (hourly over 7 days), 1m (6-hourly over 30 days). Speeds are bytes/sec averages.',
  validate: (input) => {
    if (typeof input !== 'object' || input === null) return null;
    const range = (input as { range?: unknown }).range ?? '1d';
    if (range !== '1d' && range !== '1w' && range !== '1m') return null;
    return { range };
  },
  execute: async (ctx, input) => {
    const { bucketSeconds, interval } = RANGE_PARAMS[input.range];
    const result = await ctx.pool.query(
      `SELECT
        to_char(to_timestamp(floor(extract(epoch from captured_at) / $2) * $2) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "timestamp",
        COALESCE(AVG(NULLIF((payload->>'wanDownspeed')::numeric, NULL)), 0)::float AS downspeed,
        COALESCE(AVG(NULLIF((payload->>'wanUpspeed')::numeric, NULL)), 0)::float AS upspeed,
        COALESCE(ROUND(AVG(NULLIF((payload->>'deviceCount')::numeric, NULL))), 0)::int AS "deviceCount",
        COALESCE(ROUND(AVG(NULLIF((payload->>'cpuLoad')::numeric, NULL))), 0)::int AS "cpuLoad",
        COALESCE(ROUND(AVG(NULLIF((payload->>'memUsed')::numeric, NULL))), 0)::int AS "memUsed",
        ROUND(AVG(NULLIF((payload->>'temperature')::numeric, NULL)))::int AS "temperature"
      FROM telemetry_snapshot
      WHERE router_id = $1 AND captured_at >= now() - $3::interval
      GROUP BY 1 ORDER BY 1 ASC`,
      [ctx.routerId, bucketSeconds, interval]
    );
    return {
      points: result.rows.map(
        (row: {
          timestamp: string;
          downspeed: number;
          upspeed: number;
          deviceCount: number;
          cpuLoad: number;
          memUsed: number;
          temperature: number | null;
        }) => ({
          timestamp: row.timestamp,
          downspeed: row.downspeed,
          upspeed: row.upspeed,
          deviceCount: row.deviceCount,
          cpuLoad: row.cpuLoad,
          memUsed: row.memUsed,
          temperature: row.temperature
        })
      )
    };
  }
};

// --- Tool: dashboard summary (one-shot overall view) ---

export interface DashboardSummaryInput {
  readonly nothing: undefined;
}
export interface DashboardSummaryOutput {
  readonly latestStatus: ReadonlyArray<{
    capturedAt: string;
    cpuLoad: number | null;
    memUsed: number | null;
    memTotal: number | null;
    temperature: number | null;
    wanUp: boolean | null;
    wanDownspeed: number | null;
    wanUpspeed: number | null;
    wanDownloadTotal: number | null;
    wanUploadTotal: number | null;
    upTimeSeconds: number | null;
    deviceCount: number | null;
  }>;
  readonly devices: {
    total: number;
    online: number;
    byConnectionType: ReadonlyArray<{ connectionType: string; count: number }>;
    topByLiveRate: ReadonlyArray<{
      name: string;
      online: boolean;
      downspeed: number;
      upspeed: number;
      downloadTotal: number;
      uploadTotal: number;
    }>;
  };
}

export const dashboardSummaryTool: ToolDefinition<DashboardSummaryInput, DashboardSummaryOutput> = {
  name: 'dashboard_summary',
  description:
    'One-shot overview of the network right now: latest router status (cpu, memory, temperature, WAN up/down speeds and totals, uptime), device counts online/offline by connection type, and the top devices by live rate. Use this before drilling into other tools.',
  validate: (input) => {
    if (input !== undefined && input !== null) {
      // Accept {} (and absent) only — no parameters exist.
      if (typeof input !== 'object' || Object.keys(input).length > 0) return null;
    }
    return { nothing: undefined };
  },
  execute: async (ctx) => {
    // Latest persisted telemetry sample (fields are the same normalized
    // payload the scheduler writes ~60s).
    const statusResult = await ctx.pool.query(
      `SELECT captured_at AS "capturedAt", payload
       FROM telemetry_snapshot WHERE router_id = $1
       ORDER BY captured_at DESC LIMIT 1`,
      [ctx.routerId]
    );
    const statusRow = statusResult.rows[0] as
      | { capturedAt: Date; payload: Record<string, unknown> }
      | undefined;
    const payload = statusRow?.payload ?? {};
    const num = (key: string): number | null => {
      const v = payload[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };

    const deviceResult = await ctx.pool.query(
      `SELECT id::text AS id, name, mac, ip, online
       FROM device WHERE router_id = $1`,
      [ctx.routerId]
    );
    const rows = deviceResult.rows as Array<{
      id: string;
      name: string | null;
      mac: string | null;
      ip: string | null;
      online: boolean;
    }>;

    const withLive = rows.map((row) => {
      const live = liveDeviceEntry(ctx, row.mac, row.ip);
      return {
        id: row.id,
        name: row.name,
        online: row.online,
        downspeed: live.downspeed ?? 0,
        upspeed: live.upspeed ?? 0,
        downloadTotal: live.downloadTotal ?? 0,
        uploadTotal: live.uploadTotal ?? 0,
        connectionType: live.connectionType ?? 'unknown'
      };
    });

    const byType = new Map<string, number>();
    for (const device of withLive) {
      byType.set(device.connectionType, (byType.get(device.connectionType) ?? 0) + 1);
    }

    const topByLiveRate = [...withLive]
      .sort(
        (a, b) =>
          b.downspeed + b.upspeed - (a.downspeed + a.upspeed) ||
          b.downloadTotal + b.uploadTotal - (a.downloadTotal + a.uploadTotal)
      )
      .slice(0, 5)
      .map((device) => ({
        // Names via deviceNameFor (external mode never emits raw names);
        // MAC/IP are simply not included.
        name: deviceNameFor(device.name, device.id, ctx.privacy, ctx.aliases),
        online: device.online,
        downspeed: device.downspeed,
        upspeed: device.upspeed,
        downloadTotal: device.downloadTotal,
        uploadTotal: device.uploadTotal
      }));

    return {
      latestStatus: statusRow
        ? [
            {
              capturedAt: new Date(statusRow.capturedAt).toISOString(),
              cpuLoad: num('cpuLoad'),
              memUsed: num('memUsed'),
              memTotal: num('memTotal'),
              temperature: num('temperature'),
              wanUp: payload['wanUp'] === true ? true : payload['wanUp'] === false ? false : null,
              wanDownspeed: num('wanDownspeed'),
              wanUpspeed: num('wanUpspeed'),
              wanDownloadTotal: num('wanDownloadTotal'),
              wanUploadTotal: num('wanUploadTotal'),
              upTimeSeconds: num('upTimeSeconds'),
              deviceCount: num('deviceCount')
            }
          ]
        : [],
      devices: {
        total: rows.length,
        online: rows.filter((row) => row.online).length,
        byConnectionType: [...byType.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([connectionType, count]) => ({ connectionType, count })),
        topByLiveRate
      }
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
          summary: row ? `telemetry at ${new Date(row.capturedAt).toISOString()}: ${JSON.stringify(safeTelemetry(row.payload as Record<string, unknown>))}` : null
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
        // Name goes through deviceNameFor (external mode never emits raw
        // names); the mac fallback is aliased by pseudonymize() downstream
        // when present in the summary string.
        const displayName = deviceNameFor(
          row?.name ?? null,
          input.evidenceId,
          ctx.privacy,
          ctx.aliases
        );
        return {
          found: Boolean(row),
          summary: row ? `device ${displayName} online=${row.online}` : null
        };
      }
      case 'audit_event': {
        const result = await ctx.pool.query(
          'SELECT action, outcome, occurred_at AS "occurredAt" FROM audit_event WHERE id = $1::bigint AND (router_id = $2 OR router_id IS NULL)',
          [input.evidenceId, ctx.routerId]
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

/** Fixed SQL computes counter deltas before ranking/limiting; no raw SQL tool. */
export const deviceTrafficUsageTool: ToolDefinition<
  { hours: number; limit: number }, Record<string, unknown>
> = {
  name: 'device_traffic_usage',
  description: 'Rank observed devices by downloaded bytes during the past hours (default 24, max 168). Uses persisted per-device counter deltas, NOT live speed or lifetime totals. Returns exact decimal byte strings for observed intervals, the highest observed consecutive interval with start/end evidence, sample coverage, gaps and resets. Partial observations cannot prove an exact period total or a network-wide winner.',
  validate: (input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const { hours = 24, limit = 10 } = input as { hours?: unknown; limit?: unknown };
    if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 168) return null;
    const bounded = boundedLimit(limit);
    return bounded === null ? null : { hours, limit: bounded };
  },
  execute: async (ctx, input) => {
    const end = new Date();
    const since = new Date(end.getTime() - input.hours * 3_600_000);
    const result = await ctx.pool.query(`
      WITH samples AS (
        SELECT t.id, t.captured_at,
          upper(x->>'mac') AS identity,
          NOT (x ? 'downloadCounterAvailable') AS legacy,
          CASE WHEN x->'downloadCounterAvailable' IS DISTINCT FROM 'false'::jsonb
            AND jsonb_typeof(x->'downloadTotal') = 'number'
            AND (x->>'downloadTotal')::numeric >= 0
            THEN (x->>'downloadTotal')::numeric END AS counter
        FROM telemetry_snapshot t
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(t.payload->'devices') = 'array'
            THEN t.payload->'devices' ELSE '[]'::jsonb END) x
        WHERE t.router_id = $1 AND t.captured_at >= $2 AND t.captured_at <= $3
          AND x->>'mac' ~* '^([0-9a-f]{2}:){5}[0-9a-f]{2}$'
      ), unique_samples AS (
        SELECT id, captured_at, identity, max(counter) AS counter, bool_or(legacy) AS legacy
        FROM samples GROUP BY id, captured_at, identity
      ), deltas AS (
        SELECT *, lag(counter) OVER w AS previous,
          lag(captured_at) OVER w AS previous_at,
          lag(id) OVER w AS previous_id
        FROM unique_samples
        WINDOW w AS (PARTITION BY identity ORDER BY captured_at, id)
      ), intervals AS (
        SELECT *,
          CASE WHEN previous IS NOT NULL AND counter IS NOT NULL AND counter >= previous
            THEN counter - previous END AS delta
        FROM deltas
      ), totals AS (
        SELECT identity,
          COALESCE(sum(delta), 0)::text AS "downloadBytes",
          count(*)::int AS "sampleCount",
          count(delta)::int AS "intervalCount",
          count(*) FILTER (WHERE counter < previous)::int AS resets,
          count(*) FILTER (WHERE counter IS NULL)::int AS "missingCounters",
          count(*) FILTER (WHERE legacy)::int AS "legacySamples",
          min(captured_at) AS "firstSampleAt", max(captured_at) AS "lastSampleAt",
          COALESCE(max(extract(epoch FROM captured_at - previous_at)), 0)::float AS "maxGapSeconds",
          (array_agg(id::text ORDER BY captured_at, id))[1] AS "firstEvidenceId",
          (array_agg(id::text ORDER BY captured_at DESC, id DESC))[1] AS "lastEvidenceId"
        FROM intervals GROUP BY identity
      ), peaks AS (
        SELECT DISTINCT ON (identity)
          identity,
          previous_at AS "peakStartAt",
          captured_at AS "peakEndAt",
          delta::text AS "peakDownloadBytes",
          previous_id::text AS "peakStartEvidenceId",
          id::text AS "peakEndEvidenceId"
        FROM intervals
        WHERE delta IS NOT NULL
        ORDER BY identity, delta DESC, captured_at, id
      ), usable AS (
        -- A single sample (or only reset/missing intervals) cannot support a
        -- period delta, so do not rank it as a zero-usage winner.
        SELECT totals.*, peaks."peakStartAt", peaks."peakEndAt",
          peaks."peakDownloadBytes", peaks."peakStartEvidenceId",
          peaks."peakEndEvidenceId"
        FROM totals JOIN peaks USING (identity)
        WHERE totals."intervalCount" > 0
      )
      SELECT *, count(*) OVER ()::int AS "observedDeviceCount"
      FROM usable ORDER BY "downloadBytes"::numeric DESC, identity LIMIT $4
    `, [ctx.routerId, since.toISOString(), end.toISOString(), input.limit]);
    const devices = result.rows.map((row: Record<string, unknown>) => {
      const {
        identity,
        peakStartAt,
        peakEndAt,
        peakDownloadBytes,
        peakStartEvidenceId,
        peakEndEvidenceId,
        ...metrics
      } = row;
      const toIso = (value: unknown): string | null => {
        if (value === null || value === undefined) return null;
        const date = value instanceof Date ? value : new Date(String(value));
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
      };
      const peakStart = toIso(peakStartAt);
      const peakEnd = toIso(peakEndAt);
      const peakInterval = peakStart && peakEnd && peakDownloadBytes !== null && peakDownloadBytes !== undefined
        ? {
            startAt: peakStart,
            endAt: peakEnd,
            downloadBytes: String(peakDownloadBytes),
            startEvidenceId: String(peakStartEvidenceId),
            endEvidenceId: String(peakEndEvidenceId)
          }
        : null;
      return {
        ...metrics,
        name: ctx.aliases.aliasFor('device', String(identity)),
        peakInterval
      };
    });
    return {
      since: since.toISOString(), until: end.toISOString(), timezone: 'UTC', unit: 'bytes',
      quality: devices.length ? 'sampled_partial' : 'unavailable',
      method: 'Sum non-negative consecutive counter deltas inside the window; reset intervals excluded. peakInterval is the largest observed consecutive delta, with its two UTC telemetry sample times and evidence IDs; it is not a reconstructed hourly total or rate. No boundary interpolation. MAC identity only; IP-only observations excluded. Legacy normalized missing counters may be zero. Unobserved devices/intervals cannot be ranked. Never claim exact period totals.',
      devices
    };
  }
};

/** The complete tool registry an AI provider can invoke. READ-ONLY ONLY. */
export const INVESTIGATION_TOOLS = [
  routerStatusTool,
  deviceStateTool,
  presenceHistoryTool,
  auditHistoryTool,
  telemetryTimeseriesTool,
  dashboardSummaryTool,
  evidenceLookupTool,
  deviceTrafficUsageTool
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
