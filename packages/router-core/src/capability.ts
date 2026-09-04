import type { RouterOperationEffect } from './effect.js';

/**
 * A router behavior that has been discovered to be usable at runtime.
 *
 * Capabilities are runtime facts about a router integration, discovered by
 * probing — never inferred from a model name.
 */
export const ROUTER_CAPABILITIES = [
  'router-info',
  'health-metrics',
  'device-inventory',
  'device-traffic',
  'wifi-state',
  'mesh-info',
  'wifi-160mhz',
  'device-internet-access-control'
] as const;

export type RouterCapability = (typeof ROUTER_CAPABILITIES)[number];

export function isRouterCapability(
  value: unknown
): value is RouterCapability {
  return (
    typeof value === 'string' &&
    (ROUTER_CAPABILITIES as readonly string[]).includes(value)
  );
}

/**
 * Static description of a router operation the adapter can perform.
 *
 * The `effect` classification is mandatory and must be declared by the
 * adapter author — never derived from an HTTP method.
 */
export interface RouterOperation {
  readonly id: string;
  readonly effect: RouterOperationEffect;
}
