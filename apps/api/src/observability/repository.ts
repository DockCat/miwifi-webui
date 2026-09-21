/**
 * Observability persistence: devices, presence events, telemetry.
 *
 * Telemetry rows are written ONLY by the scheduler — read endpoints must
 * never insert. Presence is event-based (one row per transition).
 */
import type pg from 'pg';
import type { PresenceEventKind } from '@miwifi-webui/router-core';

export interface DeviceRow {
  readonly id: string;
  readonly routerId: string;
  readonly mac: string | null;
  readonly name: string | null;
  readonly ip: string | null;
  readonly online: boolean;
  readonly internetAccess: boolean;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

export interface DeviceObservationUpdate {
  readonly id: string;
  readonly online: boolean;
  readonly ip?: string | null;
  readonly name?: string | null;
}

export interface PresenceEventInsert {
  readonly deviceId: string;
  readonly routerId: string;
  readonly kind: PresenceEventKind;
}

export interface TelemetrySnapshotRow {
  readonly id: string;
  readonly routerId: string;
  readonly capturedAt: Date;
  readonly payload: Record<string, unknown>;
}

export interface PresenceEventRow {
  readonly id: string;
  readonly deviceId: string;
  readonly routerId: string;
  readonly kind: PresenceEventKind;
  readonly occurredAt: Date;
}

export class ObservabilityRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listDevicesForRouter(routerId: string): Promise<DeviceRow[]> {
    const result = await this.pool.query<DeviceRow>(
      `SELECT id, router_id AS "routerId", mac, name, ip, online,
              internet_access AS "internetAccess",
              first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"
       FROM device WHERE router_id = $1 ORDER BY name NULLS LAST, mac`,
      [routerId]
    );
    return result.rows;
  }

  async listDevicesForRouterByMac(routerId: string): Promise<Map<string, DeviceRow>> {
    const rows = await this.listDevicesForRouter(routerId);
    return new Map(rows.filter((row) => row.mac !== null).map((row) => [row.mac!, row]));
  }

  async insertDevice(
    routerId: string,
    mac: string | null,
    name: string | null,
    ip: string | null
  ): Promise<DeviceRow> {
    const result = await this.pool.query<DeviceRow>(
      `INSERT INTO device (router_id, mac, name, ip, online)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, router_id AS "routerId", mac, name, ip, online,
                 internet_access AS "internetAccess",
                 first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"`,
      [routerId, mac, name, ip]
    );
    return result.rows[0]!;
  }

  async updateDeviceObservation(
    deviceId: string,
    fields: { online: boolean; ip?: string | null; name?: string | null }
  ): Promise<void> {
    await this.batchUpdateDeviceObservations([
      {
        id: deviceId,
        online: fields.online,
        ip: fields.ip,
        name: fields.name
      }
    ]);
  }

  /**
   * ADR 0005: Wrap device-observation updates and presence-event inserts in a
   * single BEGIN … COMMIT block.
   *
   * **Atomicity**: all writes succeed or all roll back together.
   * **I/O reduction**: the main benefit is eliminating per-autocommit fsync
   * overhead when `synchronous_commit = off`. Each UPDATE/INSERT is still a
   * separate server round-trip; this is not a single-statement bulk operation.
   * A future migration to `UPDATE … FROM (VALUES …)` could collapse the
   * round-trips further if that becomes a bottleneck.
   */
  async batchUpdateDeviceObservations(
    updates: readonly DeviceObservationUpdate[],
    presenceEvents: readonly PresenceEventInsert[] = []
  ): Promise<void> {
    if (updates.length === 0 && presenceEvents.length === 0) return;
    const client = await this.pool.connect();
    let clientError: Error | undefined;
    try {
      await client.query('BEGIN');
      for (const update of updates) {
        await client.query(
          `UPDATE device
           SET online = $2,
               last_seen_at = CASE WHEN $2 THEN now() ELSE last_seen_at END,
               ip = COALESCE($3, ip),
               name = COALESCE($4, name)
           WHERE id = $1`,
          [update.id, update.online, update.ip ?? null, update.name ?? null]
        );
      }
      for (const pe of presenceEvents) {
        await client.query(
          'INSERT INTO device_presence_event (device_id, router_id, kind) VALUES ($1, $2, $3)',
          [pe.deviceId, pe.routerId, pe.kind]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // ROLLBACK itself failed — the connection is tainted. Log so the
        // infrastructure failure is observable before we destroy the client.
        console.error('[observability] transaction rollback failed:', rollbackError);
        // Flag connection error to pg-pool so the broken/tainted client is destroyed.
        clientError =
          rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      }
      throw error;
    } finally {
      client.release(clientError);
    }
  }


  async recordPresenceEvent(
    deviceId: string,
    routerId: string,
    kind: PresenceEventKind
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO device_presence_event (device_id, router_id, kind) VALUES ($1, $2, $3)',
      [deviceId, routerId, kind]
    );
  }

  async listPresenceEvents(
    routerId: string,
    opts: { deviceId?: string; limit?: number } = {}
  ): Promise<PresenceEventRow[]> {
    const limit = Math.min(opts.limit ?? 100, 500);
    const result = await this.pool.query<PresenceEventRow>(
      `SELECT id, device_id AS "deviceId", router_id AS "routerId", kind,
              occurred_at AS "occurredAt"
       FROM device_presence_event
       WHERE router_id = $1 AND ($2::uuid IS NULL OR device_id = $2)
       ORDER BY occurred_at DESC LIMIT $3`,
      [routerId, opts.deviceId ?? null, limit]
    );
    return result.rows;
  }

  /** Application-side view of a device's Internet access (Task 0006). */
  async setInternetAccess(deviceId: string, blocked: boolean): Promise<void> {
    await this.pool.query(
      'UPDATE device SET internet_access = $2 WHERE id = $1',
      [deviceId, !blocked]
    );
  }

  /** Scheduler-only write path for telemetry samples. */
  async insertTelemetrySnapshot(
    routerId: string,
    payload: Record<string, unknown>
  ): Promise<TelemetrySnapshotRow> {
    const result = await this.pool.query<TelemetrySnapshotRow>(
      `INSERT INTO telemetry_snapshot (router_id, payload)
       VALUES ($1, $2::jsonb)
       RETURNING id, router_id AS "routerId", captured_at AS "capturedAt",
                 payload`,
      [routerId, JSON.stringify(payload)]
    );
    return result.rows[0]!;
  }

  async listTelemetrySnapshots(
    routerId: string,
    limit = 60
  ): Promise<TelemetrySnapshotRow[]> {
    const result = await this.pool.query<TelemetrySnapshotRow>(
      `SELECT id, router_id AS "routerId", captured_at AS "capturedAt", payload
       FROM telemetry_snapshot
       WHERE router_id = $1
       ORDER BY captured_at DESC LIMIT $2`,
      [routerId, limit]
    );
    return result.rows;
  }

  /** Timeseries bucket aggregation for UniFi-style charts (1D/1W/1M). */
  async queryTimeseries(
    routerId: string,
    range: '1d' | '1w' | '1m' = '1d'
  ): Promise<TimeseriesBucketPoint[]> {
    let bucketSeconds = 300;
    let intervalStr = '24 hours';
    if (range === '1w') {
      bucketSeconds = 3600;
      intervalStr = '7 days';
    } else if (range === '1m') {
      bucketSeconds = 21600;
      intervalStr = '30 days';
    }

    const query = `
      SELECT
        to_char(to_timestamp(floor(extract(epoch from captured_at) / $2) * $2) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "timestamp",
        COALESCE(AVG(NULLIF((payload->>'wanDownspeed')::numeric, NULL)), 0)::float AS downspeed,
        COALESCE(AVG(NULLIF((payload->>'wanUpspeed')::numeric, NULL)), 0)::float AS upspeed,
        COALESCE(ROUND(AVG(NULLIF((payload->>'deviceCount')::numeric, NULL))), 0)::int AS "deviceCount",
        COALESCE(ROUND(AVG(NULLIF((payload->>'cpuLoad')::numeric, NULL))), 0)::int AS "cpuLoad",
        COALESCE(ROUND(AVG(NULLIF((payload->>'memUsed')::numeric, NULL))), 0)::int AS "memUsed",
        ROUND(AVG(NULLIF((payload->>'temperature')::numeric, NULL)))::int AS "temperature"
      FROM telemetry_snapshot
      WHERE router_id = $1 AND captured_at >= now() - $3::interval
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    const result = await this.pool.query<TimeseriesBucketPoint>(query, [
      routerId,
      bucketSeconds,
      intervalStr
    ]);
    return result.rows;
  }
}

export interface TimeseriesBucketPoint {
  readonly timestamp: string;
  readonly downspeed: number;
  readonly upspeed: number;
  readonly deviceCount: number;
  readonly cpuLoad: number;
  readonly memUsed: number;
  readonly temperature?: number | null;
}

