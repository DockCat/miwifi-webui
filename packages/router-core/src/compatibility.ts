/**
 * High-level compatibility classification for a router integration.
 *
 * This is a runtime fact derived from probing (see `probe.ts`); it must never
 * be inferred from a model-name whitelist.
 *
 * - SUPPORTED: required baseline probes succeed and expected core features
 *   are available.
 * - PARTIAL: usable, but one or more optional or expected APIs are missing.
 * - UNKNOWN: model/firmware not recognized and there is not yet enough probe
 *   evidence to classify support.
 * - INCOMPATIBLE: cannot satisfy the minimum required authentication or
 *   protocol behavior.
 */
export const ROUTER_COMPATIBILITY_STATUSES = [
  'SUPPORTED',
  'PARTIAL',
  'UNKNOWN',
  'INCOMPATIBLE'
] as const;

export type RouterCompatibilityStatus =
  (typeof ROUTER_COMPATIBILITY_STATUSES)[number];

export function isRouterCompatibilityStatus(
  value: unknown
): value is RouterCompatibilityStatus {
  return (
    typeof value === 'string' &&
    (ROUTER_COMPATIBILITY_STATUSES as readonly string[]).includes(value)
  );
}
