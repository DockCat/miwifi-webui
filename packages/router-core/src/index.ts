export {
  ROUTER_COMPATIBILITY_STATUSES,
  isRouterCompatibilityStatus
} from './compatibility.js';
export type { RouterCompatibilityStatus } from './compatibility.js';

export {
  ROUTER_OPERATION_EFFECTS,
  isRouterOperationEffect
} from './effect.js';
export type { RouterOperationEffect } from './effect.js';

export {
  ROUTER_CAPABILITIES,
  isRouterCapability
} from './capability.js';
export type { RouterCapability, RouterOperation } from './capability.js';

export {
  parseIPv4,
  isPermittedIPv4,
  isIPv6Literal,
  validateRouterTarget
} from './target-validation.js';
export type { ParsedRouterTarget, IPv4Parts } from './target-validation.js';
