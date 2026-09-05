/**
 * Operation catalog: every MiWiFi request the adapter can issue, with its
 * explicit effect class and stok requirement.
 *
 * Authenticated paths use the router's native `;stok=` separator format:
 *   /cgi-bin/luci/;stok=<token>/api/<module>/<endpoint>
 * Effect is declared by the catalog author and NEVER inferred from the
 * HTTP method (MiWiFi GETs can have side effects).
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
    probe: false
  },
  /** Router login page — key/deviceId challenge source (no auth). */
  loginPage: {
    id: 'login_page',
    path: '/cgi-bin/luci/web',
    method: 'GET',
    effect: 'READ',
    requiresStok: false,
    probe: false
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
  /** Router status overview (health: cpu/mem/wan/device counts). */
  status: {
    id: 'status',
    path: '/cgi-bin/luci/;stok={stok}/api/xqsystem/status',
    method: 'GET',
    effect: 'READ',
    requiresStok: true,
    probe: true
  },
  /** Device list (misystem module). */
  deviceList: {
    id: 'device_list',
    path: '/cgi-bin/luci/;stok={stok}/api/misystem/devicelist',
    method: 'GET',
    effect: 'READ',
    requiresStok: true,
    probe: true
  },
  /** Network topology (mesh graph). */
  topoGraph: {
    id: 'topo_graph',
    path: '/cgi-bin/luci/;stok={stok}/api/misystem/topo_graph',
    method: 'GET',
    effect: 'READ',
    requiresStok: true,
    probe: false
  },
  /** WAN connection info. */
  wanInfo: {
    id: 'wan_info',
    path: '/cgi-bin/luci/;stok={stok}/api/xqnetwork/wan_info',
    method: 'GET',
    effect: 'READ',
    requiresStok: true,
    probe: true
  },
  /** Block a device's Internet access (WRITE — reversible). */
  blockInternet: {
    id: 'block_internet',
    path: '/cgi-bin/luci/;stok={stok}/api/xqsmarthome/request',
    method: 'POST',
    effect: 'WRITE',
    requiresStok: true,
    probe: false
  },
  /** Restore a device's Internet access (WRITE — reversible). */
  unblockInternet: {
    id: 'unblock_internet',
    path: '/cgi-bin/luci/;stok={stok}/api/xqsmarthome/request',
    method: 'POST',
    effect: 'WRITE',
    requiresStok: true,
    probe: false
  },
  /** Smart home device list — used to read back block state. */
  smartHomeDeviceList: {
    id: 'smarthome_devicelist',
    path: '/cgi-bin/luci/;stok={stok}/api/xqsmarthome/request',
    method: 'POST',
    effect: 'READ',
    requiresStok: true,
    probe: false
  }
} as const satisfies Record<string, RouterOperationSpec>;

export type OperationKey = keyof typeof OPERATIONS;

export function specFor(key: OperationKey): RouterOperationSpec {
  return OPERATIONS[key];
}

/** Resolve a path template with the session token (`;stok=` separator). */
export function resolvePath(spec: RouterOperationSpec, stok: string | null): string {
  if (!spec.path.includes('{stok}')) return spec.path;
  if (!stok) {
    throw new Error(`Operation ${spec.id} requires a router session.`);
  }
  return spec.path.replace('{stok}', encodeURIComponent(stok));
}
