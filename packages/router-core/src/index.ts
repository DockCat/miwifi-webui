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

// --- Adapter foundation (Task 0003) ---

export type { RouterIdentity, RouterStatusInfo } from './router-state.js';

export {
  RouterTransportError
} from './transport.js';
export type {
  RouterTransport,
  RouterTransportRequest,
  RouterTransportResponse,
  RouterTransportBody,
  RouterTransportFailure
} from './transport.js';

export {
  OPERATIONS,
  specFor,
  resolvePath
} from './operations.js';
export type { RouterOperationSpec, OperationKey } from './operations.js';

export { MiWifiAdapter } from './adapter.js';
export type { AdapterCredentials, ProbeResult, LoginResult } from './adapter.js';

export { FixtureTransport } from './fixture-transport.js';
export type { FixtureScenario } from './fixture-transport.js';

export { HttpRouterTransport } from './http-transport.js';
export type { HttpRouterTransportOptions } from './http-transport.js';

// --- Observability domain (Task 0004) ---

export {
  normalizeDevice,
  normalizeDeviceList,
  normalizeRouterStatus
} from './device-normalization.js';
export type {
  NormalizedDevice,
  RawDeviceEntry,
  NormalizedRouterStatus
} from './device-normalization.js';

export {
  transitionForExisting,
  firstSeenTransition,
  reconcilePresence,
  deviceKey
} from './presence.js';
export type {
  PresenceEventKind,
  PresenceTransition,
  StoredDeviceState,
  KeyedTransition
} from './presence.js';

// --- Access control mutation (Task 0006) ---

export {
  blockDeviceInternet,
  unblockDeviceInternet
} from './access-control.js';
export type { InternetAccessState, MutationOutcome } from './access-control.js';
