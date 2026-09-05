/**
 * Router DTOs shared between api and web.
 *
 * These are browser-safe: they NEVER include router passwords, sealed
 * credential material, or stok values.
 */

export interface RouterSummary {
  readonly id: string;
  readonly host: string;
  readonly model: string | null;
  readonly hardware: string | null;
  readonly romVersion: string | null;
  readonly compatibility: 'SUPPORTED' | 'PARTIAL' | 'UNKNOWN' | 'INCOMPATIBLE';
  readonly capabilities: string[];
  readonly lastProbedAt: string | null;
}

export interface OnboardRouterRequest {
  /** Router host/address — validated against the local/private policy. */
  readonly host: string;
  /** MiWiFi admin username (normally "admin"). */
  readonly username: string;
  /** MiWiFi admin password — sealed on arrival; never returned. */
  readonly password: string;
}

export interface OnboardRouterResponse {
  readonly router: RouterSummary;
}

export interface DeviceDTO {
  readonly id: string;
  readonly mac: string | null;
  readonly name: string | null;
  readonly ip: string | null;
  readonly online: boolean;
  readonly internetAccess: boolean;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly downspeed: number;
  readonly upspeed: number;
  readonly downloadTotal: number;
  readonly uploadTotal: number;
  readonly connectionType: 'wired' | 'wifi_2g' | 'wifi_5g' | 'guest' | 'unknown';
}

export interface TimeseriesPoint {
  readonly timestamp: string;
  readonly downspeed: number;
  readonly upspeed: number;
  readonly deviceCount: number;
  readonly cpuLoad: number;
  readonly memUsed: number;
}

