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
import type { NormalizedDevice } from '@miwifi-webui/router-core';
import type { RouterRepository } from '../router/repository.js';
import type { ObservabilityRepository } from './repository.js';
import type { EventBridge } from './event-bridge.js';

export interface PollingConfig {
  readonly statusIntervalMs: number;
  readonly inventoryIntervalMs: number;
  readonly telemetryIntervalMs: number;
}

export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  statusIntervalMs: 15_000,
  inventoryIntervalMs: 30_000,
  telemetryIntervalMs: 60_000
};

interface ActiveRouter {
  readonly id: string;
  readonly host: string;
  adapter: MiWifiAdapter | null;
}

export class PollingScheduler {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private readonly config: PollingConfig;
  /** Most recent in-memory status per router (never persisted on read). */
  private latestStatus = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly routerRepository: RouterRepository,
    private readonly observabilityRepository: ObservabilityRepository,
    private readonly events: EventBridge,
    private readonly masterKey: string,
    config: Partial<PollingConfig> = {}
  ) {
    this.config = { ...DEFAULT_POLLING_CONFIG, ...config };
  }

  /** In-memory status snapshot for read endpoints (no DB write). */
  getStatus(routerId: string): Record<string, unknown> | null {
    return this.latestStatus.get(routerId) ?? null;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Timer only fires while the loop is alive; unref'd so the process
    // can exit without an explicit stop in dev/test.
    const statusTimer = setInterval(() => void this.pollStatusAll(), this.config.statusIntervalMs);
    const inventoryTimer = setInterval(() => void this.pollInventoryAll(), this.config.inventoryIntervalMs);
    const telemetryTimer = setInterval(() => void this.persistTelemetryAll(), this.config.telemetryIntervalMs);
    for (const timer of [statusTimer, inventoryTimer, telemetryTimer]) {
      timer.unref?.();
      this.timers.push(timer);
    }
    // Prime immediately rather than waiting a full interval.
    void this.pollStatusAll();
    void this.pollInventoryAll();
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private async activeRouters(): Promise<ActiveRouter[]> {
    const rows = await this.routerRepository.listRouters();
    return rows
      .filter((row) => row.compatibility === 'SUPPORTED' || row.compatibility === 'PARTIAL')
      .map((row) => ({ id: row.id, host: row.host, adapter: null }));
  }

  private async adapterFor(router: ActiveRouter): Promise<MiWifiAdapter | null> {
    if (router.adapter) return router.adapter;
    const credential = await this.routerRepository.loadCredential(
      router.id,
      this.masterKey
    );
    if (!credential) return null;
    const { HttpRouterTransport } = await import('@miwifi-webui/router-core');
    const transport = new HttpRouterTransport({ host: router.host });
    router.adapter = new MiWifiAdapter(transport, credential);
    return router.adapter;
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
      } catch {
        this.events.publish('router-status', {
          routerId: router.id,
          status: { capturedAt: new Date().toISOString(), unreachable: true }
        });
      }
    }
  }

  /** ~30s: device inventory + presence reconciliation. */
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

        // Stored state keyed the same way (mac-preferred).
        const storedDevices = await this.observabilityRepository.listDevicesForRouter(router.id);
        const storedByMac = new Map<string, typeof storedDevices[number]>();
        const storedByIp = new Map<string, typeof storedDevices[number]>();
        for (const row of storedDevices) {
          if (row.mac) storedByMac.set(`mac:${row.mac}`, row);
          if (row.ip) storedByIp.set(`ip:${row.ip}`, row);
        }
        const stored = new Map<string, { online: boolean }>();
        const storedByKey = new Map<string, typeof storedDevices[number]>();
        for (const [key, row] of [...storedByMac, ...storedByIp]) {
          if (!storedByKey.has(key)) {
            storedByKey.set(key, row);
            stored.set(key, { online: row.online });
          }
        }

        const { events } = reconcilePresence(
          new Map([...observed].map(([key, v]) => [key, { online: v.online }])),
          stored
        );

        // Apply inventory upserts + presence events.
        for (const [key, entry] of observed) {
          const existing = storedByKey.get(key);
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
            await this.observabilityRepository.updateDeviceObservation(existing.id, {
              online: entry.device.online,
              ip: entry.device.ip ?? null,
              name: entry.device.name ?? null
            });
          }
        }

        for (const event of events) {
          const existing = storedByKey.get(event.key);
          if (!existing) continue; // FIRST_SEEN handled above
          await this.observabilityRepository.recordPresenceEvent(
            existing.id,
            router.id,
            event.kind
          );
          this.events.publish('presence', {
            routerId: router.id,
            deviceId: existing.id,
            kind: event.kind,
            mac: existing.mac
          });
        }

        this.events.publish('inventory', {
          routerId: router.id,
          count: devices.length
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
        const response = await adapter.call('status');
        const status = normalizeRouterStatus(response.body);
        await this.observabilityRepository.insertTelemetrySnapshot(router.id, {
          capturedAt: new Date().toISOString(),
          ...status
        });
      } catch {
        // Missed sample; the next interval retries. No synthetic rows.
      }
    }
  }
}
