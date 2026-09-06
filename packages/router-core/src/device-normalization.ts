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
  readonly devname?: unknown;
  readonly oname?: unknown;
  readonly nickname?: unknown;
  readonly ip?: unknown;
  readonly ipaddress?: unknown;
  readonly online?: unknown;
  readonly active?: unknown;
  readonly statistics?: unknown;
  readonly type?: unknown;
  readonly isap?: unknown;
  readonly download?: unknown;
  readonly upload?: unknown;
  readonly downspeed?: unknown;
  readonly upspeed?: unknown;
  readonly downloadTotal?: unknown;
  readonly uploadTotal?: unknown;
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
  const name =
    asString(entry.name) ??
    asString(entry.oname) ??
    asString(entry.devname) ??
    asString(entry.nickname);
  const ipInfo = extractIpAndSpeed(entry.ip);
  const ip = ipInfo.ip ?? asString(entry.ipaddress);
  const online =
    entry.online === true ||
    entry.online === 'true' ||
    entry.online === 1 ||
    entry.online === '1' ||
    entry.active === 1 ||
    entry.active === '1' ||
    entry.active === true;

  if (mac === undefined && ip === undefined) return null;

  const stats =
    entry.statistics !== null && typeof entry.statistics === 'object'
      ? (entry.statistics as Record<string, unknown>)
      : undefined;

  const downspeed =
    asNumber(stats?.['downspeed']) ??
    ipInfo.downspeed ??
    asNumber(entry.downspeed) ??
    0;
  const upspeed =
    asNumber(stats?.['upspeed']) ??
    ipInfo.upspeed ??
    asNumber(entry.upspeed) ??
    0;
  const downloadTotal =
    asNumber(stats?.['download']) ??
    asNumber(entry.download) ??
    asNumber(entry.downloadTotal) ??
    0;
  const uploadTotal =
    asNumber(stats?.['upload']) ??
    asNumber(entry.upload) ??
    asNumber(entry.uploadTotal) ??
    0;
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
    (payload as { dev?: unknown }).dev ??
    (payload as { devices?: unknown }).devices ??
    (Array.isArray(payload) ? payload : undefined);
  if (!Array.isArray(list)) return [];
  const devices: NormalizedDevice[] = [];
  for (const entry of list) {
    const normalized = normalizeDevice(entry as RawDeviceEntry);
    if (normalized) devices.push(normalized);
  }
  return devices;
}

export interface NormalizedHardwareInfo {
  readonly mac?: string;
  readonly platform?: string;
  readonly version?: string;
  readonly channel?: string;
  readonly sn?: string;
  readonly displayRomVer?: string;
  readonly displayName?: string;
}

/** Router health/status normalization (cpu, mem, wan, temperature...). */
export interface NormalizedRouterStatus {
  readonly cpuLoad: number | undefined;
  readonly cpuCore: number | undefined;
  readonly cpuHz: string | undefined;
  readonly memUsed: number | undefined;
  readonly memTotal: number | undefined;
  readonly memUsage: number | undefined;
  readonly memType: string | undefined;
  readonly memHz: string | undefined;
  readonly temperature: number | undefined;
  readonly wanUp: boolean | undefined;
  readonly deviceCount: number | undefined;
  readonly deviceCountOnline: number | undefined;
  readonly deviceCountAll: number | undefined;
  /** WAN down/up speeds (bytes/sec), where the firmware reports them. */
  readonly wanDownspeed: number | undefined;
  readonly wanUpspeed: number | undefined;
  readonly wanMaxDownspeed: number | undefined;
  readonly wanMaxUpspeed: number | undefined;
  readonly wanDownloadTotal: number | undefined;
  readonly wanUploadTotal: number | undefined;
  /** Router uptime in seconds, where reported. */
  readonly upTimeSeconds: number | undefined;
  /** Hardware information, where reported. */
  readonly hardwareInfo: NormalizedHardwareInfo | undefined;
  /** Active device observations reported by status payload, where present. */
  readonly devices?: readonly NormalizedDevice[];
}

function parseMemoryMB(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v > 1024 * 1024 ? Math.round(v / (1024 * 1024)) : Math.round(v);
  }
  if (typeof v === 'string') {
    const match = v.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
    if (match && match[1]) {
      const amount = parseFloat(match[1]);
      const unit = (match[2] ?? '').toUpperCase();
      if (unit === 'GB' || unit === 'G') return Math.round(amount * 1024);
      if (unit === 'KB' || unit === 'K') return Math.round(amount / 1024);
      if (unit === 'B') return Math.round(amount / (1024 * 1024));
      if (!unit && amount > 1024 * 1024) return Math.round(amount / (1024 * 1024));
      return Math.round(amount);
    }
  }
  return undefined;
}

export function normalizeRouterStatus(payload: unknown): NormalizedRouterStatus {
  const empty: NormalizedRouterStatus = {
    cpuLoad: undefined,
    cpuCore: undefined,
    cpuHz: undefined,
    memUsed: undefined,
    memTotal: undefined,
    memUsage: undefined,
    memType: undefined,
    memHz: undefined,
    temperature: undefined,
    wanUp: undefined,
    deviceCount: undefined,
    deviceCountOnline: undefined,
    deviceCountAll: undefined,
    wanDownspeed: undefined,
    wanUpspeed: undefined,
    wanMaxDownspeed: undefined,
    wanMaxUpspeed: undefined,
    wanDownloadTotal: undefined,
    wanUploadTotal: undefined,
    upTimeSeconds: undefined,
    hardwareInfo: undefined
  };
  if (payload === null || typeof payload !== 'object') return empty;
  const body = payload as Record<string, unknown>;
  const num = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const clean = v.trim().replace(/[%℃°C]/gi, '').trim();
      if (clean !== '' && Number.isFinite(Number(clean))) {
        return Number(clean);
      }
    }
    return undefined;
  };
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

  // CPU: support nested object { core, hz, load } or flat numeric values
  let cpuLoad: number | undefined;
  let cpuCore: number | undefined;
  let cpuHz: string | undefined;

  const cpuObj =
    body['cpu'] !== null && typeof body['cpu'] === 'object'
      ? (body['cpu'] as Record<string, unknown>)
      : undefined;

  if (cpuObj) {
    cpuCore = num(cpuObj['core']);
    cpuHz = str(cpuObj['hz']);
    const rawLoad = num(cpuObj['load']);
    if (rawLoad !== undefined) {
      // Upstream MiWiFi reports load as a fraction between 0.0 and 1.0 (e.g. 0.09 for 9%)
      cpuLoad = rawLoad > 0 && rawLoad <= 1 ? Math.round(rawLoad * 100) : Math.round(rawLoad);
    }
  } else {
    const rawLoad = num(body['cpu'] ?? body['cpuLoad'] ?? body['load']);
    if (rawLoad !== undefined) {
      cpuLoad = rawLoad > 0 && rawLoad < 1 ? Math.round(rawLoad * 100) : Math.round(rawLoad);
    }
  }

  // Memory: support nested object { type, usage, total, hz } or flat numeric values
  let memUsed: number | undefined;
  let memTotal: number | undefined;
  let memUsage: number | undefined;
  let memType: string | undefined;
  let memHz: string | undefined;

  const memObj =
    body['mem'] !== null && typeof body['mem'] === 'object'
      ? (body['mem'] as Record<string, unknown>)
      : undefined;

  if (memObj) {
    memType = str(memObj['type']);
    memHz = str(memObj['hz']);
    const rawUsage = num(memObj['usage']);
    memTotal = parseMemoryMB(memObj['total']) ?? parseMemoryMB(body['memTotal']);
    if (rawUsage !== undefined) {
      memUsage = rawUsage <= 1 && rawUsage > 0 ? Number((rawUsage * 100).toFixed(1)) : rawUsage;
      if (memTotal !== undefined) {
        const ratio = rawUsage <= 1 && rawUsage > 0 ? rawUsage : rawUsage / 100;
        memUsed = Math.round(memTotal * ratio);
      }
    }
    if (memUsed === undefined) {
      memUsed = num(memObj['used'] ?? body['mem'] ?? body['memUsed']);
    }
  } else {
    memUsed = num(body['mem'] ?? body['memUsed']);
    memTotal = parseMemoryMB(body['memTotal']);
    if (memUsed !== undefined && memTotal !== undefined && memTotal > 0) {
      memUsage = Number(((memUsed / memTotal) * 100).toFixed(1));
    }
  }

  // Device counts: support nested object { all, online, ... } or flat count
  const countObj =
    body['count'] !== null && typeof body['count'] === 'object'
      ? (body['count'] as Record<string, unknown>)
      : undefined;

  let deviceCountOnline: number | undefined;
  let deviceCountAll: number | undefined;
  let deviceCount: number | undefined;

  if (countObj) {
    deviceCountOnline = num(countObj['online'] ?? countObj['online_without_mash']);
    deviceCountAll = num(countObj['all'] ?? countObj['all_without_mash']);
    deviceCount = deviceCountOnline ?? deviceCountAll;
  } else {
    deviceCount = num(body['deviceCount'] ?? body['count']);
    deviceCountOnline = num(body['deviceCountOnline'] ?? body['online']);
    deviceCountAll = num(body['deviceCountAll'] ?? body['all']);
  }

  // WAN: support nested object { downspeed, upspeed, maxdownloadspeed, maxuploadspeed, upload, download }
  const wanObj =
    body['wan'] !== null && typeof body['wan'] === 'object'
      ? (body['wan'] as Record<string, unknown>)
      : undefined;

  // wanStatistics appears on RD05-class firmware: {downspeed, upspeed, ...}
  const wanStats =
    body['wanStatistics'] !== null && typeof body['wanStatistics'] === 'object'
      ? (body['wanStatistics'] as Record<string, unknown>)
      : undefined;

  const wanDownspeed = num(wanObj?.['downspeed'] ?? wanStats?.['downspeed']);
  const wanUpspeed = num(wanObj?.['upspeed'] ?? wanStats?.['upspeed']);
  const wanMaxDownspeed = num(wanObj?.['maxdownloadspeed']);
  const wanMaxUpspeed = num(wanObj?.['maxuploadspeed']);
  const wanDownloadTotal = num(wanObj?.['download']);
  const wanUploadTotal = num(wanObj?.['upload']);

  let wanUp: boolean | undefined;
  if (wanObj !== undefined) {
    wanUp = true;
  } else if (body['wan'] === 'up' || body['wan'] === true) {
    wanUp = true;
  } else if (body['wan'] === 'down' || body['wan'] === false) {
    wanUp = false;
  } else if (wanStats !== undefined) {
    wanUp = true; // router reporting live WAN statistics implies link up
  }

  // Hardware metadata
  const hwObj =
    body['hardware'] !== null && typeof body['hardware'] === 'object'
      ? (body['hardware'] as Record<string, unknown>)
      : undefined;

  const hardwareInfo: NormalizedHardwareInfo | undefined = hwObj
    ? {
        mac: str(hwObj['mac']),
        platform: str(hwObj['platform']),
        version: str(hwObj['version']),
        channel: str(hwObj['channel']),
        sn: str(hwObj['sn']),
        displayRomVer: str(hwObj['DisplayRomVer'] ?? hwObj['displayRomVer']),
        displayName: str(hwObj['displayName'] ?? hwObj['display_name'])
      }
    : undefined;

  // Devices: if present in status payload (e.g. body['dev'] or body['devices'])
  const devList = body['dev'] ?? body['devices'];
  const statusDevices = Array.isArray(devList)
    ? devList
        .map((d) =>
          d !== null && typeof d === 'object'
            ? normalizeDevice({ online: true, ...(d as RawDeviceEntry) })
            : null
        )
        .filter((d): d is NormalizedDevice => d !== null)
    : undefined;

  return {
    cpuLoad,
    cpuCore,
    cpuHz,
    memUsed,
    memTotal,
    memUsage,
    memType,
    memHz,
    temperature: num(body['temperature'] ?? body['temp']),
    wanUp,
    deviceCount,
    deviceCountOnline,
    deviceCountAll,
    wanDownspeed,
    wanUpspeed,
    wanMaxDownspeed,
    wanMaxUpspeed,
    wanDownloadTotal,
    wanUploadTotal,
    upTimeSeconds: num(body['upTime'] ?? body['uptime']),
    hardwareInfo,
    ...(statusDevices && statusDevices.length > 0 ? { devices: statusDevices } : {})
  };
}
