/**
 * Normalized router-domain types.
 *
 * These are the application's view of a router — never raw MiWiFi
 * payloads. Unknown/missing values are undefined, never faked.
 */

/** Static identity/hardware attributes observed from a router. */
export interface RouterIdentity {
  /** Router-reported model string, e.g. "RD03" / unknown. */
  readonly model: string | undefined;
  /** Hardware identifier. */
  readonly hardware: string | undefined;
  /** ROM / firmware version string. */
  readonly romVersion: string | undefined;
  /** Channel/region code where reported. */
  readonly channel: string | undefined;
  /** Login challenge mode: true => SHA256 (newEncryptMode=1), false => SHA1. */
  readonly newEncryptMode: boolean;
}

/** Live router status summary (normalized from init/status endpoints). */
export interface RouterStatusInfo {
  readonly routerId: string;
  readonly identity: RouterIdentity;
  readonly compatibility: RouterCompatibilityStatusLike;
}

/** Loose structural form used internally to avoid import cycles. */
export interface RouterCompatibilityStatusLike {
  readonly supported: boolean;
  readonly partial: boolean;
}
