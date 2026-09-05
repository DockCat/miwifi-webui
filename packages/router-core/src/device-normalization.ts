/**
 * Device normalization: raw MiWiFi device-list payloads -> application
 * device domain objects.
 *
 * MAC is an observation attribute, not identity: the application identity
 * is the synthetic device_id (CONTEXT.md — Device). Unknown/missing
 * fields are undefined, never invented.
 */

export type DeviceConnectionType = 'wired' | 'wifi_2g' | 'wifi_5g' | 'guest' | 'unknown';

export interface NormalizedDevice {
  readonly mac: string | undefined;
  readonly name: string | undefined;
  readonly ip: string | undefined;
  readonly online: boolean;
  readonly downspeed: number;
  readonly upspeed: number;
  readonly downloadTotal: number;
  readonly uploadTotal: number;
  readonly connectionType: DeviceConnectionType;
}

/** Raw MiWiFi device-list entry (loose — parsed defensively). */
export interface RawDeviceEntry {
  readonly mac?: unknown;
  readonly name?: unknown;
  readonly oname?: unknown;
  readonly nickname?: unknown;
  readonly ip?: unknown;
  readonly ipaddress?: unknown;
  readonly online?: unknown;
  readonly statistics?: unknown;
  readonly type?: unknown;
  readonly isap?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Extract a device IP and optional ip-level speeds from string or firmware array forms. */
function extractIpAndSpeed(value: unknown): {
  ip: string | undefined;
  downspeed?: number;
  upspeed?: number;
} {
  if (typeof value === 'string' && value.length > 0) return { ip: value };
  // RD05-class firmware: ip: [{ ip: "192.168.31.107", downspeed: "123", upspeed: "45", active: 1, ... }]
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry !== null && typeof entry === 'object') {
        const item = entry as Record<string, unknown>;
        const ip = asString(item['ip']);
        if (ip) {
          return {
            ip,
            downspeed: asNumber(item['downspeed']),
            upspeed: asNumber(item['upspeed'])
          };
        }
      }
    }
  }
  return { ip: undefined };
}

function parseConnectionType(type: unknown): DeviceConnectionType {
  const t = typeof type === 'string' ? Number.parseInt(type, 10) : type;
  if (t === 0) return 'wired';
  if (t === 1) return 'wifi_2g';
  if (t === 2) return 'wifi_5g';
  if (t === 3) return 'guest';
  return 'unknown';
}

export function normalizeDevice(entry: RawDeviceEntry): NormalizedDevice | null {
  if (entry === null || typeof entry !== 'object') return null;
  const mac = asString(entry.mac)?.toUpperCase();
  const name = asString(entry.name) ?? asString(entry.oname) ?? asString(entry.nickname);
  const ipInfo = extractIpAndSpeed(entry.ip);
  const ip = ipInfo.ip ?? asString(entry.ipaddress);
  const online =
    entry.online === true ||
    entry.online === 'true' ||
    entry.online === 1 ||
    entry.online === '1';

  if (mac === undefined && ip === undefined) return null;

  const stats =
    entry.statistics !== null && typeof entry.statistics === 'object'
      ? (entry.statistics as Record<string, unknown>)
      : undefined;

  const downspeed = asNumber(stats?.['downspeed']) ?? ipInfo.downspeed ?? 0;
  const upspeed = asNumber(stats?.['upspeed']) ?? ipInfo.upspeed ?? 0;
  const downloadTotal = asNumber(stats?.['download']) ?? 0;
  const uploadTotal = asNumber(stats?.['upload']) ?? 0;
  const connectionType = parseConnectionType(entry.type);

  return {
    mac,
    name,
    ip,
    online,
    downspeed,
    upspeed,
    downloadTotal,
    uploadTotal,
    connectionType
  };
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
  /** WAN down/up speeds (bytes/sec), where the firmware reports them. */
  readonly wanDownspeed: number | undefined;
  readonly wanUpspeed: number | undefined;
  /** Router uptime in seconds, where reported. */
  readonly upTimeSeconds: number | undefined;
}

export function normalizeRouterStatus(payload: unknown): NormalizedRouterStatus {
  const empty: NormalizedRouterStatus = {
    cpuLoad: undefined,
    memUsed: undefined,
    memTotal: undefined,
    wanUp: undefined,
    deviceCount: undefined,
    wanDownspeed: undefined,
    wanUpspeed: undefined,
    upTimeSeconds: undefined
  };
  if (payload === null || typeof payload !== 'object') return empty;
  const body = payload as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v)
      ? v
      : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
        ? Number(v)
        : undefined;

  // wanStatistics appears on RD05-class firmware: {downspeed, upspeed, ...}
  const wanStats =
    body['wanStatistics'] !== null && typeof body['wanStatistics'] === 'object'
      ? (body['wanStatistics'] as Record<string, unknown>)
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
          : wanStats !== undefined
            ? true // router reporting live WAN statistics implies link up
            : undefined,
    deviceCount: num(body['deviceCount'] ?? body['count']),
    wanDownspeed: num(wanStats?.['downspeed']),
    wanUpspeed: num(wanStats?.['upspeed']),
    upTimeSeconds: num(body['upTime'])
  };
}
