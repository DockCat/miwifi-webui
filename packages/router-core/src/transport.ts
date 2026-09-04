/**
 * Router transport: the ONLY place MiWiFi URL construction happens.
 *
 * Implementations:
 * - HttpRouterTransport (real router over fetch, host validated upstream);
 * - FixtureTransport (deterministic scripted responses for tests).
 *
 * The transport receives a validated host and a path/operation key — never
 * a caller-supplied URL. It must not follow redirects to unvalidated
 * destinations.
 */

/** Body payload accepted by the transport (form or JSON). */
export type RouterTransportBody = Record<string, string | number | boolean>;

export interface RouterTransportRequest {
  /** Operation key defined by the adapter catalog (e.g. "init_info"). */
  readonly operation: string;
  /** Path template WITH stok placeholder already resolved, or plain path. */
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly body?: RouterTransportBody;
  /** Wall-clock timeout for this call. */
  readonly timeoutMs: number;
}

export interface RouterTransportResponse {
  readonly status: number;
  readonly body: unknown;
}

export type RouterTransportFailure =
  | { kind: 'offline' }
  | { kind: 'timeout' }
  | { kind: 'http-status'; status: number }
  | { kind: 'malformed' }
  | { kind: 'aborted' };

export class RouterTransportError extends Error {
  constructor(
    public readonly failure: RouterTransportFailure,
    operation: string
  ) {
    super(`router transport failure (${failure.kind}) on ${operation}`);
    this.name = 'RouterTransportError';
  }
}

export interface RouterTransport {
  /**
   * Execute a single router request. Throws RouterTransportError on
   * transport-level failures; HTTP-level errors are returned as responses.
   */
  request(request: RouterTransportRequest): Promise<RouterTransportResponse>;
}
