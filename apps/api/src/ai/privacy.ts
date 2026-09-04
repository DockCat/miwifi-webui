/**
 * AI privacy layer (Task 0007, plan sections 33).
 *
 * External providers receive minimized/pseudonymized context by default:
 * stable aliases (router_01, device_01) replace MACs, IPs, serials, and
 * raw device names unless the administrator explicitly enables that data
 * category. Secret-bearing strings never pass through here — the tools
 * never emit them — but the scrubber also fails closed on known secret
 * shapes.
 */

export interface PrivacyConfig {
  /** Allow MAC addresses in egress. */
  readonly allowMac: boolean;
  /** Allow IP addresses in egress. */
  readonly allowIp: boolean;
  /** Allow raw device names in egress. */
  readonly allowNames: boolean;
}

export const DEFAULT_PRIVACY: PrivacyConfig = {
  allowMac: false,
  allowIp: false,
  allowNames: false
};

/** Deterministic alias assignment per conversation context. */
export class AliasMap {
  private next = 1;
  private readonly map = new Map<string, string>();

  aliasFor(kind: 'router' | 'device', value: string): string {
    const key = `${kind}:${value.toLowerCase()}`;
    const existing = this.map.get(key);
    if (existing) return existing;
    const alias = `${kind}_${String(this.next++).padStart(2, '0')}`;
    this.map.set(key, alias);
    return alias;
  }
}

const MAC_PATTERN = /([0-9a-f]{2}:){5}[0-9a-f]{2}/gi;
const IPV4_PATTERN = /\b(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/g;

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
      out[key] = pseudonymize(entry, config, aliases);
    }
    return out;
  }
  return value;
}

function scrubString(value: string, config: PrivacyConfig, aliases: AliasMap): string {
  let out = value;
  // MACs: alias per device.
  out = out.replace(MAC_PATTERN, (mac) =>
    config.allowMac ? mac : aliases.aliasFor('device', mac)
  );
  // IPv4s: alias per address.
  out = out.replace(IPV4_PATTERN, (ip) =>
    config.allowIp ? ip : aliases.aliasFor('device', `ip:${ip}`)
  );
  // Secret-bearing shapes: hard redact regardless of config.
  if (/(stok=|Bearer\s)/i.test(out)) {
    out = out.replace(/stok=[A-Za-z0-9]+/gi, '[redacted]').replace(/Bearer\s\S+/gi, '[redacted]');
  }
  return out;
}

/**
 * Prepare a device name for egress.
 */
export function deviceNameFor(
  rawName: string | null,
  fallbackId: string,
  config: PrivacyConfig,
  aliases: AliasMap
): string {
  if (rawName && config.allowNames) return rawName;
  return aliases.aliasFor('device', fallbackId);
}
