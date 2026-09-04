/**
 * Router target validation.
 *
 * The backend must not become an arbitrary SSRF proxy: router onboarding
 * accepts a host/address, not an arbitrary URL. This module defines the
 * permitted local/private-network policy every router target must pass
 * before the adapter opens a connection.
 */

export type IPv4Parts = [number, number, number, number];

export interface ParsedRouterTarget {
  /** Normalized target, e.g. "192.168.31.1" or "miwifi.home". */
  readonly host: string;
}

/**
 * Parse a dotted-quad IPv4 address into numeric parts.
 * Returns null for anything that is not a plain dotted-quad literal.
 */
export function parseIPv4(input: string): IPv4Parts | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number.parseInt(part, 10);
    if (value > 255) return null;
    octets.push(value);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

/**
 * True when the IPv4 literal is inside a private/reserved/local range the
 * application is allowed to talk to:
 *
 * - 10.0.0.0/8 (RFC1918)
 * - 172.16.0.0/12 (RFC1918)
 * - 192.168.0.0/16 (RFC1918)
 * - 169.254.0.0/16 (link-local)
 * - 127.0.0.0/8 (loopback — useful for mocked routers in tests)
 */
export function isPermittedIPv4(ip: IPv4Parts): boolean {
  const [a, b] = ip;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  return false;
}

/**
 * Hostname shapes that may be a router on the local network.
 *
 * Deliberately conservative: single-label hostnames ("miwifi", "router"),
 * dotted multi-label names ending in `.home`, `.local`, `.lan`, or `.internal`
 * (`miwifi.home`, `router.lan`), and hostnames with a literal IPv4 address.
 * A dotless public-looking domain or a public-looking dotted name is
 * rejected until target validation gains DNS resolution.
 */
const PERMITTED_HOSTNAME_PATTERNS: readonly RegExp[] = [
  /^[a-z][a-z0-9-]*$/i,
  /^([a-z][a-z0-9-]*\.)+(home|local|lan|internal)$/i
];

/**
 * Validate a router target supplied at onboarding.
 *
 * Accepts:
 * - IPv4 literals in permitted private/local ranges (e.g. 192.168.31.1);
 * - conservative local hostname shapes (e.g. `miwifi`, `router.lan`);
 * - IPv6 literals in permitted ranges (::1, fe80::/10, fc00::/7).
 *
 * Rejects public addresses, arbitrary domains, URLs with scheme/path, and
 * anything containing user info or a port.
 *
 * IPv6: only literals are handled today; DNS-resolved targets, zone
 * identifiers, and hostname allowlisting beyond the shapes above are left
 * to the adapter task.
 */
export function validateRouterTarget(input: string): ParsedRouterTarget | null {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 253) return null;

  // No scheme, userinfo, port, or path components — the adapter owns URL
  // construction and never receives a URL from the caller.
  if (/[:/@]/.test(raw)) {
    // IPv6 literals contain ':' and are checked below before this rule can
    // reject them; handle them first.
    if (!raw.includes(':')) return null;
    if (!isIPv6Literal(raw)) return null;
    if (raw.includes('@') || raw.includes('/')) return null;
    return { host: raw };
  }

  const ipv4 = parseIPv4(raw);
  if (ipv4 !== null) {
    if (!isPermittedIPv4(ipv4)) return null;
    return { host: raw };
  }

  if (raw.includes(':')) {
    if (!isIPv6Literal(raw)) return null;
    return { host: raw };
  }

  if (!PERMITTED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(raw))) {
    return null;
  }

  return { host: raw.toLowerCase() };
}

/**
 * Minimal IPv6 literal recognition for the permitted ranges:
 * ::1 (loopback), fe80::/10 (link-local), fc00::/7 (unique-local).
 */
export function isIPv6Literal(input: string): boolean {
  if (!input.includes(':')) return false;
  // Reject embedded IPv4 tails for now — full IPv6 parsing is adapter-task
  // scope; keep the policy surface conservative.
  if (input.includes('.')) return false;
  const lower = input.toLowerCase();

  const expandIPv6 = (literal: string): string[] | null => {
    // Structural gate first: exactly one '::' allowed (or none), and every
    // other colon must be a single separator between 1-4 hex groups.
    if (!/^([0-9a-f]{1,4}(:[0-9a-f]{1,4})*)?(::([0-9a-f]{1,4}(:[0-9a-f]{1,4})*)?)?$/.test(literal)) {
      return null;
    }
    const halves = literal.split('::');
    const head = halves[0] ? halves[0]!.split(':').filter(Boolean) : [];
    const tail = halves.length === 2 && halves[1] ? halves[1]!.split(':').filter(Boolean) : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 2 && missing < 0) return null;
    if (halves.length === 1 && head.length !== 8) return null;
    const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'), ...tail];
    return groups.map((group) => group.padStart(4, '0'));
  };

  const groups = expandIPv6(lower);
  if (groups === null || groups.length !== 8) return false;
  const first = Number.parseInt(groups[0]!, 16);
  if (Number.isNaN(first)) return false;

  // ::1 loopback
  const isLoopback = groups.every((group, index) =>
    index === 7 ? group === '0001' : group === '0000'
  );
  if (isLoopback) return true;

  // fe80::/10 link-local
  if (first >= 0xfe80 && first <= 0xfebf) return true;

  // fc00::/7 unique-local
  if ((first & 0xfe00) === 0xfc00) return true;

  return false;
}
