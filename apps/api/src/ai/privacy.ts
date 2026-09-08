import { isIP } from 'node:net';
/**
 * AI privacy layer (Task 0007, plan sections 33).
 *
 * There are exactly two privacy modes, derived from the provider mode:
 * - local provider: identifiers pass through (the endpoint is the
 *   administrator's own machine);
 * - external provider: MACs, IPs and device names are always pseudonymized.
 *   The alias legend stays local; there is no external names opt-out.
 *
 * Secret-bearing strings never pass through here — the tools never emit
 * them — but the scrubber also fails closed on known secret shapes.
 */

export interface PrivacyConfig {
  /** Allow MAC addresses in egress. */
  readonly allowMac: boolean;
  /** Allow IP addresses in egress. */
  readonly allowIp: boolean;
  /** Allow raw device names in egress. */
  readonly allowNames: boolean;
}

/** Local providers see identifiers as-is. External providers never do. */
export const LOCAL_PRIVACY: PrivacyConfig = {
  allowMac: true,
  allowIp: true,
  allowNames: true
};

export const EXTERNAL_PRIVACY: PrivacyConfig = {
  allowMac: false,
  allowIp: false,
  allowNames: false
};

/** Deterministic alias assignment per conversation context. */
export class AliasMap {
  private next = 1;
  private readonly map = new Map<string, string>();
  /** alias key -> original value with its original casing (first seen). */
  private readonly originals = new Map<string, string>();

  aliasFor(kind: 'router' | 'device', value: string): string {
    const key = `${kind}:${value.toLowerCase()}`;
    const existing = this.map.get(key);
    if (existing) return existing;
    const alias = `${kind}_${String(this.next++).padStart(2, '0')}`;
    this.map.set(key, alias);
    this.originals.set(key, value);
    return alias;
  }

  registerDevice(row: { id: string; name?: string | null; mac?: string | null; ip?: string | null }): void {
    const identifiers = [
      ...(row.name ? [`name:${row.name}`] : []),
      ...(row.mac ? [row.mac] : []),
      ...(row.ip ? [`ip:${row.ip}`] : [])
    ];
    // Older legends may contain only a MAC/IP/name. Reuse that alias for the
    // newly observed synthetic id so one device is not split into two aliases.
    const idKey = `device:${row.id.toLowerCase()}`;
    const stableIdentifiers = [
      ...(row.mac ? [row.mac] : []),
      ...(row.ip ? [`ip:${row.ip}`] : [])
    ];
    const existing = this.map.get(idKey) ?? stableIdentifiers
      .map((original) => this.map.get(`device:${original.toLowerCase()}`))
      .find((alias): alias is string => Boolean(alias));
    const alias = existing ?? this.aliasFor('device', row.id);
    for (const original of [row.id, ...identifiers]) {
      const key = `device:${original.toLowerCase()}`;
      if (!this.map.has(key)) {
        this.map.set(key, alias);
        this.originals.set(key, original);
      }
    }
  }

  scrubKnownNames(text: string): string {
    const names = this.legend().filter((entry) => entry.original.startsWith('name:'))
      .sort((a, b) => b.original.length - a.original.length);
    for (const { alias, original } of names) {
      const escaped = original.slice(5).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(escaped, 'gi'), () => alias);
    }
    return text;
  }

  /**
   * The alias legend: which raw value each alias stood for. Kept in the
   * local investigation record (never sent to the provider) so a finding
   * full of device_01-style aliases remains readable to the administrator.
   */
  legend(): ReadonlyArray<{ alias: string; original: string }> {
    return [...this.map.entries()]
      .map(([key, alias]) => ({
        alias,
        original: this.originals.get(key) ?? key.slice(key.indexOf(':') + 1)
      }))
      .sort((a, b) => a.alias.localeCompare(b.alias));
  }

  /**
   * Seed this map from legends recorded on earlier turns of the same
   * session, so an alias keeps meaning the same device across the whole
   * conversation. Legend originals are exactly the values once passed to
   * aliasFor (MACs raw, IPs as "ip:1.2.3.4", names as "name:xxx",
   * device-id fallbacks as the raw id); the internal key therefore
   * reconstructs as `<kind>:<original>.toLowerCase()`. Idempotent and
   * order-independent (dedupe by key); the counters resume after the
   * highest seeded alias number.
   */
  seedFromLegend(legends: ReadonlyArray<{ alias: string; original: string }>): void {
    for (const { alias, original } of legends) {
      if (typeof original !== 'string' || original.length === 0) continue;
      const kind = /^(device|router)_\d+$/.exec(alias)?.[1];
      if (!kind) continue;
      const key = `${kind}:${original.toLowerCase()}`;
      if (this.map.has(key)) continue;
      this.map.set(key, alias);
      this.originals.set(key, original);
      const num = Number.parseInt(alias.slice(`${kind}_`.length), 10);
      if (Number.isInteger(num) && num >= this.next) this.next = num + 1;
    }
  }
}

const MAC_PATTERN = /([0-9a-f]{2}:){5}[0-9a-f]{2}/gi;
const IPV4_PATTERN = /\b(25[0-5]|2[4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[4]\d|1\d\d|[1-9]?\d)){3}\b/g;

/** Keys whose string values are device names (pseudonymized unless allowed). */
const NAME_KEYS = new Set(['name', 'oname', 'nickname', 'hostname', 'devicename']);

function isSecretKey(key: string): boolean {
  return /stok|password|api[_-]?key|master[_-]?key|secret|token|authorization|cookie/i.test(key);
}

/**
 * Pseudonymize a tool result for external egress.
 *
 * Returns a NEW object; the input is never mutated. Any string field that
 * matches a secret shape is replaced with "[redacted]" — fail-closed even
 * though tools are not supposed to emit secrets.
 */
export function pseudonymize(
  value: unknown,
  config: PrivacyConfig,
  aliases: AliasMap
): unknown {
  if (typeof value === 'string') return scrubString(value, config, aliases);
  if (Array.isArray(value)) return value.map((entry) => pseudonymize(entry, config, aliases));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isSecretKey(key)) {
        out[key] = '[redacted]';
        continue;
      }
      if (!config.allowNames && NAME_KEYS.has(key.toLowerCase())) {
        // Names have no recognizable shape, so they are handled by key, not
        // by regex — this is the second line of defense; the first is that
        // the tools never emit raw names in external mode at all.
        out[key] =
          typeof entry === 'string' && entry.length > 0 && !/^(device|router)_\d+$/.test(entry)
            ? aliases.aliasFor('device', `name:${entry}`)
            : entry;
        continue;
      }
      out[key] = pseudonymize(entry, config, aliases);
    }
    return out;
  }
  return value;
}

function scrubString(value: string, config: PrivacyConfig, aliases: AliasMap): string {
  let out = value;
  for (const key of ['APP_MASTER_KEY', 'AI_PROVIDER_API_KEY']) {
    const secret = process.env[key];
    if (secret) out = out.split(secret).join('[redacted]');
  }
  out = config.allowNames ? out : aliases.scrubKnownNames(out);
  // MACs: alias per device.
  out = out.replace(MAC_PATTERN, (mac) =>
    config.allowMac ? mac : aliases.aliasFor('device', mac)
  );
  // Compressed/full IPv6, including mapped IPv4 and zone identifiers.
  out = out.replace(/[0-9a-f:.]+(?:%[a-z0-9_-]+)?/gi, (candidate) =>
    !config.allowIp && isIP(candidate.split('%')[0]!) === 6
      ? aliases.aliasFor('device', `ip:${candidate}`) : candidate);
  // IPv4s: alias per address.
  out = out.replace(IPV4_PATTERN, (ip) =>
    config.allowIp ? ip : aliases.aliasFor('device', `ip:${ip}`)
  );
  // Secret-bearing shapes: hard redact regardless of config.
  if (/(stok=|Bearer\s)/i.test(out)) {
    out = out.replace(/stok=[A-Za-z0-9]+/gi, '[redacted]').replace(/Bearer\s\S+/gi, '[redacted]');
  }
  out = out.replace(/(?:password|passwd|api[_-]?key|master[_-]?key|secret|token|cookie|密碼|密码)["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[redacted]');
  return out;
}

/**
 * Prepare a device name for egress (tool-output layer, the primary defense).
 */
export function deviceNameFor(
  rawName: string | null,
  fallbackId: string,
  config: PrivacyConfig,
  aliases: AliasMap
): string {
  if (rawName && config.allowNames) return rawName;
  aliases.registerDevice({ id: fallbackId, name: rawName });
  return aliases.aliasFor('device', fallbackId);
}
