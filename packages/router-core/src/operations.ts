/**
 * Operation catalog: every MiWiFi request the adapter can issue, with its
 * explicit effect class and stok requirement.
 *
 * The path is a template with an optional {stok} placeholder. Effect is
 * declared by the catalog author and NEVER inferred from the HTTP method
 * (MiWiFi GETs can have side effects).
 */
import type { RouterOperationEffect } from './effect.js';

export interface RouterOperationSpec {
  /** Catalog key — also used as transport `operation`. */
  readonly id: string;
  /** Path template; {stok} is substituted with the session token. */
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly effect: RouterOperationEffect;
  /** Whether a valid stok session is required. */
  readonly requiresStok: boolean;
  /** Included in the read-only compatibility probe. */
  readonly probe: boolean;
}

export const OPERATIONS = {
  /** Init info — no auth; read-only; reveals model/firmware. */
  initInfo: {
    id: 'init_info',
    path: '/cgi-bin/luci/api/xqsystem/init_info',
    method: 'GET',
    effect: 'READ',
    requiresStok: false,
    probe: true
  },
  /** Router login — authenticates and returns stok. */
  login: {
    id: 'login',
    path: '/cgi-bin/luci/api/xqsystem/login',
    method: 'POST',
    effect: 'READ',
    requiresStok: false,
    probe: false
  },
  /** Router status/info under session. */
  routerInfo: {
    id: 'router_info',
    path: '/cgi-bin/luci/api/xqsystem/{stok}/router_info',
    method: 'GET',
    effect: 'READ',
    requiresStok: true,
    probe: true
  },
  /** Device list. */
  deviceList: {
    id: 'device_list',
    path: '/cgi-bin/luci/api/misystem/{stok}/devicelist',
    method: 'GET',
    effect: 'READ',
    requiresStok: true,
    probe: true
  },
  /** Router status overview (health). */
  status: {
    id: 'status',
    path: '/cgi-bin/luci/api/xqsystem/{stok}/status',
    method: 'GET',
    effect: 'READ',
    requiresStok: true,
    probe: true
  },
  /** Block a device's Internet access (WRITE — reversible). */
  blockInternet: {
    id: 'block_internet',
    path: '/cgi-bin/luci/api/xqsmarthome/{stok}/request',
    method: 'POST',
    effect: 'WRITE',
    requiresStok: true,
    probe: false
  }
} as const satisfies Record<string, RouterOperationSpec>;

export type OperationKey = keyof typeof OPERATIONS;

export function specFor(key: OperationKey): RouterOperationSpec {
  return OPERATIONS[key];
}

/** Resolve a path template with the session token. */
export function resolvePath(spec: RouterOperationSpec, stok: string | null): string {
  if (!spec.path.includes('{stok}')) return spec.path;
  if (!stok) {
    throw new Error(`Operation ${spec.id} requires a router session.`);
  }
  return spec.path.replace('{stok}', encodeURIComponent(stok));
}
