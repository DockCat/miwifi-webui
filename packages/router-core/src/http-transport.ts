/**
 * HTTP transport for a real router.
 *
 * Security invariants:
 * - Constructed only with a host already validated by validateRouterTarget;
 *   paths come exclusively from the adapter catalog.
 * - No redirects followed (redirect could point outside the validated
 *   target — the adapter re-issues requests instead).
 * - Timeouts enforced via AbortSignal.
 * - stok-bearing URLs are never logged: failures are classified by kind.
 */
import { RouterTransportError, type RouterTransport, type RouterTransportRequest, type RouterTransportResponse } from './transport.js';

export interface HttpRouterTransportOptions {
  /** Validated router host (from validateRouterTarget). */
  readonly host: string;
  /** Scheme — http for the local MiWiFi API (HTTPS support later). */
  readonly scheme?: 'http' | 'https';
  readonly defaultTimeoutMs?: number;
}

export class HttpRouterTransport implements RouterTransport {
  private readonly base: string;

  constructor(private readonly options: HttpRouterTransportOptions) {
    const scheme = options.scheme ?? 'http';
    // Host is pre-validated; it never carries userinfo, port, or path.
    this.base = `${scheme}://${options.host}`;
  }

  async request(req: RouterTransportRequest): Promise<RouterTransportResponse> {
    const url = `${this.base}${req.path}`;
    const timeoutMs = req.timeoutMs ?? this.options.defaultTimeoutMs ?? 5_000;
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: req.method,
        signal,
        // NEVER follow redirects: a redirect could leave the validated
        // local target. Router re-login is handled at the adapter level.
        redirect: 'manual',
        headers: req.body
          ? { 'content-type': 'application/x-www-form-urlencoded' }
          : undefined,
        body:
          req.method === 'POST' && req.body
            ? new URLSearchParams(
                Object.entries(req.body).map(
                  ([k, v]) => [k, String(v)] as [string, string]
                )
              ).toString()
            : undefined
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      const code = cause?.code ?? '';
      if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EHOSTUNREACH') {
        throw new RouterTransportError({ kind: 'offline' }, req.operation);
      }
      if ((error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
        throw new RouterTransportError({ kind: 'timeout' }, req.operation);
      }
      throw new RouterTransportError({ kind: 'aborted' }, req.operation);
    }

    // Redirects are treated as failures — the adapter decides how to retry.
    if (response.status >= 300 && response.status < 400) {
      throw new RouterTransportError({ kind: 'http-status', status: response.status }, req.operation);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RouterTransportError({ kind: 'malformed' }, req.operation);
    }
    return { status: response.status, body };
  }
}
