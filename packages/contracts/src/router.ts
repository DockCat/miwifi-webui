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
