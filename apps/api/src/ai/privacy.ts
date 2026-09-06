/**
 * AI privacy layer (Task 0007, plan sections 33).
 *
 * There are exactly two privacy modes, derived from the provider mode:
 * - local provider: identifiers pass through (the endpoint is the
 *   administrator's own machine);
 * - external provider: MACs, IPs, and device names are ALWAYS pseudonymized.
 *   There is no per-category opt-out — data leaving the home is minimized,
 *   full stop. (The former AI_EGRESS_ALLOW_* switches were removed for
 *   being impossible to reason about; the alias legend below restores
 *   human readability without relaxing egress.)
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
          typeof entry === 'string' && entry.length > 0
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
 * Prepare a device name for egress (tool-output layer, the primary defense).
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
