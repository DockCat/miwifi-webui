/**
 * Device normalization: raw MiWiFi device-list payloads -> application
 * device domain objects.
 *
 * MAC is an observation attribute, not identity: the application identity
 * is the synthetic device_id (CONTEXT.md — Device). Unknown/missing
 * fields are undefined, never invented.
 */

export interface NormalizedDevice {
  readonly mac: string | undefined;
  readonly name: string | undefined;
  readonly ip: string | undefined;
  readonly online: boolean;
}

/** Raw MiWiFi device-list entry (loose — parsed defensively). */
export interface RawDeviceEntry {
  readonly mac?: unknown;
  readonly name?: unknown;
  readonly nickname?: unknown;
  readonly ip?: unknown;
  readonly ipaddress?: unknown;
  readonly online?: unknown;
  readonly statistics?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function normalizeDevice(entry: RawDeviceEntry): NormalizedDevice | null {
  if (entry === null || typeof entry !== 'object') return null;
  const mac = asString(entry.mac)?.toUpperCase();
  const name = asString(entry.name) ?? asString(entry.nickname);
  const ip = asString(entry.ip) ?? asString(entry.ipaddress);
  const online =
    entry.online === true ||
    entry.online === 'true' ||
    entry.online === 1 ||
    entry.online === '1';

  if (mac === undefined && ip === undefined) return null;
  return { mac, name, ip, online };
}

export function normalizeDeviceList(payload: unknown): readonly NormalizedDevice[] {
  if (payload === null || typeof payload !== 'object') return [];
  const list =
    (payload as { list?: unknown }).list ??
    (Array.isArray(payload) ? payload : undefined);
  if (!Array.isArray(list)) return [];
  const devices: NormalizedDevice[] = [];
  for (const entry of list) {
    const normalized = normalizeDevice(entry as RawDeviceEntry);
    if (normalized) devices.push(normalized);
  }
  return devices;
}

/** Router health/status normalization (cpu, mem, wan...). */
export interface NormalizedRouterStatus {
  readonly cpuLoad: number | undefined;
  readonly memUsed: number | undefined;
  readonly memTotal: number | undefined;
  readonly wanUp: boolean | undefined;
  readonly deviceCount: number | undefined;
}

export function normalizeRouterStatus(payload: unknown): NormalizedRouterStatus {
  const empty: NormalizedRouterStatus = {
    cpuLoad: undefined,
    memUsed: undefined,
    memTotal: undefined,
    wanUp: undefined,
    deviceCount: undefined
  };
  if (payload === null || typeof payload !== 'object') return empty;
  const body = payload as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v)
      ? v
      : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
        ? Number(v)
        : undefined;
  return {
    cpuLoad: num(body['cpu'] ?? body['cpuLoad'] ?? body['load']),
    memUsed: num(body['mem'] ?? body['memUsed']),
    memTotal: num(body['memTotal']),
    wanUp:
      body['wan'] === 'up' || body['wan'] === true
        ? true
        : body['wan'] === 'down' || body['wan'] === false
          ? false
          : undefined,
    deviceCount: num(body['deviceCount'] ?? body['count'])
  };
}
