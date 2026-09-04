/**
 * Explicit effect classification for every router operation.
 *
 * The MiWiFi API's HTTP method is NOT a safe indicator of operation effect —
 * a MiWiFi GET endpoint can still have side effects. Every router operation
 * the application can perform must declare one of these classes explicitly,
 * independent of transport details.
 *
 * - READ: expected not to alter router/network state.
 * - WRITE: changes state but is intended to be reversible and non-disruptive.
 * - DISRUPTIVE: can temporarily interrupt network or router operation.
 * - DESTRUCTIVE: may cause irreversible loss, reset, firmware risk, or major
 *   administrative disruption.
 */
export const ROUTER_OPERATION_EFFECTS = [
  'READ',
  'WRITE',
  'DISRUPTIVE',
  'DESTRUCTIVE'
] as const;

export type RouterOperationEffect = (typeof ROUTER_OPERATION_EFFECTS)[number];

export function isRouterOperationEffect(
  value: unknown
): value is RouterOperationEffect {
  return (
    typeof value === 'string' &&
    (ROUTER_OPERATION_EFFECTS as readonly string[]).includes(value)
  );
}
