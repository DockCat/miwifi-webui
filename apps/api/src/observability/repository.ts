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
    await this.pool.query(
      `UPDATE device
       SET online = $2,
           last_seen_at = CASE WHEN $2 THEN now() ELSE last_seen_at END,
           ip = COALESCE($3, ip),
           name = COALESCE($4, name)
       WHERE id = $1`,
      [deviceId, fields.online, fields.ip ?? null, fields.name ?? null]
    );
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
}
