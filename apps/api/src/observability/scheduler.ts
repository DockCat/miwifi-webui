/**
 * Router polling scheduler (Task 0004).
 *
 * Runs inside the API process (ADR 0004: no separate worker for v1).
 * Cadences follow plan section 21:
 *   - router status       ~15 s  (current-state; in-memory + SSE)
 *   - device inventory    ~30 s  (presence reconciliation)
 *   - persisted telemetry ~60 s  (telemetry_snapshot rows — scheduler only)
 *
 * UI requests NEVER trigger persistence (plan: reads do not sample).
 * All timers are unref'd so tests/process shutdown are not held alive.
 */
import type pg from 'pg';
import {
  deviceKey,
  normalizeDeviceList,
  normalizeRouterStatus,
  reconcilePresence,
  MiWifiAdapter
} from '@miwifi-webui/router-core';
import type { NormalizedDevice, PresenceEventKind } from '@miwifi-webui/router-core';
import type { RouterRepository } from '../router/repository.js';
import type {
  ObservabilityRepository,
  DeviceObservationUpdate,
  PresenceEventInsert
} from './repository.js';
import type { EventBridge } from './event-bridge.js';
import { loadRetentionPolicy, type RetentionPolicy } from '../retention/policy.js';
import type { PollingIntervalConfig } from '../config.js';

/**
 * Re-exported alias so external callers (e.g. tests, main.ts) can reference
 * `PollingConfig` without importing from config.ts directly. The authoritative
 * shape lives in `PollingIntervalConfig`; keep the two in sync.
 */
export type PollingConfig = PollingIntervalConfig;

export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  statusIntervalMs: 15_000,
  inventoryIntervalMs: 60_000,
  telemetryIntervalMs: 60_000
};

/**
 * 10-minute coarse heartbeat threshold (ADR 0005).
 * Refreshes last_seen_at periodically for continuously online devices without
 * flooding PostgreSQL with autocommit writes every polling cycle.
 */
const COARSE_HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

function isDeviceObservationDirty(
  existing: { online: boolean; ip: string | null; name: string | null; lastSeenAt?: Date },
  observed: { online: boolean; ip?: string; name?: string }
): boolean {
  if (existing.online !== observed.online) return true;
  if (observed.ip !== undefined && existing.ip !== observed.ip) return true;
  if (observed.name !== undefined && existing.name !== observed.name) return true;
  // Design decision (ADR 0005): the coarse heartbeat refresh only applies to
  // *online* devices. Offline devices have no meaningful `last_seen_at` to
  // advance — their timestamp is intentionally frozen at the moment they went
  // offline and is only updated again on the next ONLINE state transition.
  // This means a device that stays offline indefinitely will never generate a
  // heartbeat write, which is the desired behaviour.
  if (observed.online) {
    const lastSeenTime = existing.lastSeenAt ? new Date(existing.lastSeenAt).getTime() : 0;
    if (Date.now() - lastSeenTime > COARSE_HEARTBEAT_INTERVAL_MS) {
      return true;
    }
  }
  return false;
}

interface ActiveRouter {
  readonly id: string;
  readonly host: string;
  adapter: MiWifiAdapter | null;
}

export class PollingScheduler {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private readonly config: PollingConfig;
  private readonly retention: RetentionPolicy;
  /** Most recent in-memory status per router (never persisted on read). */
  private latestStatus = new Map<string, Record<string, unknown>>();
  /** Most recent in-memory devices per router (keyed by mac, ip, and deviceKey). */
  private latestDevices = new Map<string, Map<string, NormalizedDevice>>();
  /** Cached adapter instances per router to reuse authenticated sessions. */
  private readonly adapters = new Map<string, MiWifiAdapter>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly routerRepository: RouterRepository,
    private readonly observabilityRepository: ObservabilityRepository,
    private readonly events: EventBridge,
    private readonly masterKey: string,
    config: Partial<PollingConfig> = {}
  ) {
    this.config = { ...DEFAULT_POLLING_CONFIG, ...config };
    this.retention = loadRetentionPolicy();
  }

  /** In-memory status snapshot for read endpoints (no DB write). */
  getStatus(routerId: string): Record<string, unknown> | null {
    return this.latestStatus.get(routerId) ?? null;
  }

  /** In-memory devices snapshot with real-time bandwidth & traffic stats. */
  getLatestDevices(routerId: string): Map<string, NormalizedDevice> | null {
    return this.latestDevices.get(routerId) ?? null;
  }

  /** Get cached authenticated adapter for a router if present. */
  getAdapter(routerId: string): MiWifiAdapter | null {
    return this.adapters.get(routerId) ?? null;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Timer only fires while the loop is alive; unref'd so the process
    // can exit without an explicit stop in dev/test.
    const statusTimer = setInterval(() => void this.pollStatusAll(), this.config.statusIntervalMs);
    const inventoryTimer = setInterval(() => void this.pollInventoryAll(), this.config.inventoryIntervalMs);
    const telemetryTimer = setInterval(() => void this.persistTelemetryAll(), this.config.telemetryIntervalMs);
    const retentionTimer = setInterval(() => void this.purgeInvestigations(), 24 * 60 * 60 * 1000);
    for (const timer of [statusTimer, inventoryTimer, telemetryTimer, retentionTimer]) {
      timer.unref?.();
      this.timers.push(timer);
    }
    // Prime immediately rather than waiting a full interval.
    void this.pollStatusAll();
    void this.pollInventoryAll();
    void this.purgeInvestigations();
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.adapters.clear();
  }

  /** Daily: run the full retention pass across all categories. */
  private async purgeInvestigations(): Promise<void> {
    try {
      const { RetentionRepository } = await import('../retention/repository.js');
      const repository = new RetentionRepository(this.pool);
      const results = await repository.purgeAll(this.retention);
      const total = results.reduce((sum, result) => sum + result.purged, 0);
      if (total > 0) {
        this.events.publish('retention', {
          purged: Object.fromEntries(results.map((r) => [r.category, r.purged]))
        });
      }
    } catch {
      // Retention is best-effort per pass; next run retries.
    }
  }

  private async activeRouters(): Promise<ActiveRouter[]> {
    const rows = await this.routerRepository.listRouters();
    const active = rows
      .filter((row) => row.compatibility === 'SUPPORTED' || row.compatibility === 'PARTIAL')
      .map((row) => ({ id: row.id, host: row.host, adapter: null }));
    const activeIds = new Set(active.map((r) => r.id));
    for (const id of this.adapters.keys()) {
      if (!activeIds.has(id)) {
        this.adapters.delete(id);
      }
    }
    return active;
  }

  private async adapterFor(router: ActiveRouter): Promise<MiWifiAdapter | null> {
    const cached = this.adapters.get(router.id);
    if (cached) return cached;
    const credential = await this.routerRepository.loadCredential(
      router.id,
      this.masterKey
    );
    if (!credential) {
      this.adapters.delete(router.id);
      return null;
    }
    const { HttpRouterTransport } = await import('@miwifi-webui/router-core');
    const transport = new HttpRouterTransport({ host: router.host });
    const adapter = new MiWifiAdapter(transport, credential);
    this.adapters.set(router.id, adapter);
    return adapter;
  }

  /** ~15s: current router status (in-memory + SSE only). */
  private async pollStatusAll(): Promise<void> {
    for (const router of await this.activeRouters()) {
      try {
        const adapter = await this.adapterFor(router);
        if (!adapter) continue;
        const response = await adapter.call('status');
        const status = normalizeRouterStatus(response.body);
        const payload = {
          capturedAt: new Date().toISOString(),
          ...status
        };
        this.latestStatus.set(router.id, payload);
        this.events.publish('router-status', { routerId: router.id, status: payload });

        if (status.devices && status.devices.length > 0) {
          const deviceMap = this.latestDevices.get(router.id) ?? new Map<string, NormalizedDevice>();
          for (const sDev of status.devices) {
            const key = deviceKey(sDev.mac, sDev.ip);
            const existing =
              (sDev.mac ? deviceMap.get(`mac:${sDev.mac}`) : undefined) ??
              (sDev.ip ? deviceMap.get(`ip:${sDev.ip}`) : undefined) ??
              (key ? deviceMap.get(key) : undefined);
            const merged: NormalizedDevice = {
              ...(existing ?? sDev),
              mac: sDev.mac ?? existing?.mac,
              name: sDev.name ?? existing?.name,
              ip: sDev.ip ?? existing?.ip,
              online: sDev.online || (existing?.online ?? true),
              downspeed: sDev.downspeed || (existing?.downspeed ?? 0),
              upspeed: sDev.upspeed || (existing?.upspeed ?? 0),
              downloadTotal: sDev.downloadCounterAvailable === true
                ? sDev.downloadTotal
                : (existing?.downloadTotal ?? 0),
              downloadCounterAvailable:
                sDev.downloadCounterAvailable ?? existing?.downloadCounterAvailable,
              uploadTotal: sDev.uploadTotal || (existing?.uploadTotal ?? 0),
              connectionType:
                sDev.connectionType !== 'unknown'
                  ? sDev.connectionType
                  : (existing?.connectionType ?? 'unknown')
            };
            if (key) deviceMap.set(key, merged);
            if (merged.mac) deviceMap.set(`mac:${merged.mac}`, merged);
            if (merged.ip) deviceMap.set(`ip:${merged.ip}`, merged);
          }
          this.latestDevices.set(router.id, deviceMap);
        }
      } catch {
        const payload = {
          capturedAt: new Date().toISOString(),
          unreachable: true
        };
        this.latestStatus.set(router.id, payload);
        this.events.publish('router-status', {
          routerId: router.id,
          status: payload
        });
      }
    }
  }

  /** Periodic: device inventory + presence reconciliation (default 60s). */
  private async pollInventoryAll(): Promise<void> {
    for (const router of await this.activeRouters()) {
      try {
        const adapter = await this.adapterFor(router);
        if (!adapter) continue;
        const response = await adapter.call('deviceList');
        const devices: readonly NormalizedDevice[] = normalizeDeviceList(response.body);

        // Build observed map keyed by mac (then ip).
        const observed = new Map<string, { online: boolean; device: NormalizedDevice }>();
        for (const device of devices) {
          const key = deviceKey(device.mac, device.ip);
          if (key) observed.set(key, { online: device.online, device });
        }

        // Stored state keyed the same way (mac-preferred canonical key).
        const storedDevices = await this.observabilityRepository.listDevicesForRouter(router.id);
        const storedByMac = new Map<string, typeof storedDevices[number]>();
        const storedByIp = new Map<string, typeof storedDevices[number]>();
        const stored = new Map<string, { online: boolean }>();
        const storedByKey = new Map<string, typeof storedDevices[number]>();

        for (const row of storedDevices) {
          const macUpper = row.mac?.toUpperCase();
          if (macUpper) storedByMac.set(macUpper, row);
          if (row.ip) storedByIp.set(row.ip, row);
          const key = deviceKey(macUpper ?? undefined, row.ip ?? undefined);
          if (key && !storedByKey.has(key)) {
            storedByKey.set(key, row);
            stored.set(key, { online: row.online });
          }
        }

        const { events } = reconcilePresence(
          new Map([...observed].map(([key, v]) => [key, { online: v.online }])),
          stored
        );

        // Apply inventory upserts + presence events.
        const pendingUpdates = new Map<string, DeviceObservationUpdate>();

        for (const [key, entry] of observed) {
          const entryMacUpper = entry.device.mac?.toUpperCase();
          const existing =
            storedByKey.get(key) ??
            (entryMacUpper ? storedByMac.get(entryMacUpper) : undefined) ??
            (entry.device.ip ? storedByIp.get(entry.device.ip) : undefined);
          if (!existing) {
            if (!entry.device.online) continue; // only register devices seen online
            const inserted = await this.observabilityRepository.insertDevice(
              router.id,
              entry.device.mac ?? null,
              entry.device.name ?? null,
              entry.device.ip ?? null
            );
            await this.observabilityRepository.recordPresenceEvent(inserted.id, router.id, 'FIRST_SEEN');
            this.events.publish('presence', {
              routerId: router.id,
              deviceId: inserted.id,
              kind: 'FIRST_SEEN',
              mac: inserted.mac
            });
          } else {
            // ADR 0005: Change-Detection Inventory (dirty checking).
            // Skip database writes if status attributes have not changed and last_seen_at is recent (<10m).
            if (isDeviceObservationDirty(existing, entry.device)) {
              pendingUpdates.set(existing.id, {
                id: existing.id,
                online: entry.device.online,
                ip: entry.device.ip ?? null,
                name: entry.device.name ?? null
              });
            }
          }
        }

        // Tuple of { db: record to persist, pub: payload to broadcast } so both
        // halves travel together and can't diverge between the two loops.
        const presenceEvents: Array<{
          db: PresenceEventInsert;
          pub: { routerId: string; deviceId: string; kind: PresenceEventKind; mac?: string | null };
        }> = [];

        for (const event of events) {
          const existing = storedByKey.get(event.key);
          if (!existing) continue; // FIRST_SEEN handled above
          if (event.kind === 'OFFLINE' || event.kind === 'ONLINE') {
            const prev = pendingUpdates.get(existing.id);
            pendingUpdates.set(existing.id, {
              id: existing.id,
              online: event.kind === 'ONLINE',
              ip: prev?.ip ?? existing.ip,
              name: prev?.name ?? existing.name
            });
          }
          presenceEvents.push({
            db: { deviceId: existing.id, routerId: router.id, kind: event.kind },
            pub: { routerId: router.id, deviceId: existing.id, kind: event.kind, mac: existing.mac }
          });
        }

        // ADR 0005: Commit all pending observation updates and presence transitions
        // in a single transaction to eliminate write amplification and guarantee atomicity.
        if (pendingUpdates.size > 0 || presenceEvents.length > 0) {
          await this.observabilityRepository.batchUpdateDeviceObservations(
            Array.from(pendingUpdates.values()),
            presenceEvents.map((pe) => pe.db)
          );
        }

        for (const { pub } of presenceEvents) {
          this.events.publish('presence', pub);
        }


        const prevMap = this.latestDevices.get(router.id);
        const deviceMap = new Map<string, NormalizedDevice>();
        const enrichedDevices: NormalizedDevice[] = [];
        for (const device of devices) {
          const prev =
            (device.mac ? prevMap?.get(`mac:${device.mac}`) : undefined) ??
            (device.ip ? prevMap?.get(`ip:${device.ip}`) : undefined);
          const enriched: NormalizedDevice = {
            ...device,
            downloadTotal: device.downloadCounterAvailable === true
              ? device.downloadTotal
              : (prev?.downloadTotal ?? 0),
            downloadCounterAvailable:
              device.downloadCounterAvailable ?? prev?.downloadCounterAvailable,
            uploadTotal: device.uploadTotal || prev?.uploadTotal || 0,
            downspeed: device.downspeed || prev?.downspeed || 0,
            upspeed: device.upspeed || prev?.upspeed || 0
          };
          enrichedDevices.push(enriched);
          const key = deviceKey(enriched.mac, enriched.ip);
          if (key) deviceMap.set(key, enriched);
          if (enriched.mac) deviceMap.set(`mac:${enriched.mac}`, enriched);
          if (enriched.ip) deviceMap.set(`ip:${enriched.ip}`, enriched);
        }
        this.latestDevices.set(router.id, deviceMap);

        this.events.publish('inventory', {
          routerId: router.id,
          count: enrichedDevices.filter((d) => d.online).length,
          devices: enrichedDevices.map((d) => ({
            mac: d.mac,
            name: d.name,
            ip: d.ip,
            online: d.online,
            downspeed: d.downspeed,
            upspeed: d.upspeed,
            downloadTotal: d.downloadTotal,
            uploadTotal: d.uploadTotal,
            connectionType: d.connectionType
          }))
        });
      } catch {
        // Router unreachable: next reconciliation pass will mark devices
        // OFFLINE via the missing-from-inventory path.
      }
    }
  }

  /** ~60s: persist one telemetry snapshot per router (scheduler only). */
  private async persistTelemetryAll(): Promise<void> {
    for (const router of await this.activeRouters()) {
      try {
        const adapter = await this.adapterFor(router);
        if (!adapter) continue;
        let status: ReturnType<typeof normalizeRouterStatus> | null = null;
        try {
          const response = await adapter.call('status');
          status = normalizeRouterStatus(response.body);
        } catch {
          // A health endpoint outage must not discard a usable inventory
          // sample below.
        }
        // Status is the canonical health sample. Some firmware exposes no
        // client counters there, so supplement it with the read-only device
        // inventory endpoint when available. Without this sample there is no
        // honest way to answer a historical per-device traffic question.
        let devices = status?.devices;
        const needsInventory = !devices || devices.length === 0 ||
          devices.some((device) => device.downloadCounterAvailable !== true);
        if (needsInventory) {
          try {
            const inventory = await adapter.call('deviceList');
            const normalized = normalizeDeviceList(inventory.body);
            if (normalized.length > 0) devices = normalized;
          } catch {
            // Keep the health sample; the traffic tool will report unavailable.
          }
        }
        if (!status && (!devices || devices.length === 0)) continue;
        await this.observabilityRepository.insertTelemetrySnapshot(router.id, {
          capturedAt: new Date().toISOString(),
          ...(status ?? {}),
          ...(devices && devices.length > 0 ? { devices } : {})
        });
      } catch {
        // Missed sample; the next interval retries. No synthetic rows.
      }
    }
  }
}
