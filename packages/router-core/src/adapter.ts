/**
 * MiWifiAdapter — the backend abstraction owning all router behavior
 * (ADR 0001). Owns login, the stok session (ephemeral, memory-only), the
 * read-only compatibility probe, and capability normalization.
 *
 * The stok never leaves this class: not persisted, not logged, not
 * returned in any DTO.
 */
import { isRouterCapability, type RouterCapability } from './capability.js';
import type { RouterCompatibilityStatus } from './compatibility.js';
import {
  resolvePath,
  specFor,
  type OperationKey,
  type RouterOperationSpec
} from './operations.js';
import {
  RouterTransportError,
  type RouterTransport,
  type RouterTransportResponse
} from './transport.js';
import type { RouterIdentity } from './router-state.js';
import { createHash } from 'node:crypto';

/**
 * MiWiFi login password challenge hash.
 *
 * Legacy:  SHA1(nonce + SHA1(password + key))
 * New:     SHA256(nonce + SHA256(password + key))
 *
 * The plaintext password never crosses the transport boundary.
 */
export function hashPasswordChallenge(
  algorithm: 'sha1' | 'sha256',
  nonce: string,
  password: string,
  key: string
): string {
  const digest = (input: string): string => {
    if (algorithm === 'sha256') {
      return createHash('sha256').update(input).digest('hex');
    }
    return createHash('sha1').update(input).digest('hex');
  };
  return digest(nonce + digest(password + key));
}

export interface AdapterCredentials {
  readonly username: string;
  readonly password: string;
}

export interface ProbeResult {
  readonly identity: RouterIdentity;
  readonly status: RouterCompatibilityStatus;
  readonly capabilities: readonly RouterCapability[];
  /** True when the minimum protocol behavior (login + init) worked. */
  readonly authenticated: boolean;
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_credentials' | 'router_offline' | 'malformed_response' };

export class MiWifiAdapter {
  /** Ephemeral router session token — memory only, never persisted. */
  private stok: string | null = null;
  private stokExpiresAt = 0;
  private static readonly STOK_TTL_MS = 30 * 60 * 1000; // conservative

  constructor(
    private readonly transport: RouterTransport,
    private readonly credentials: AdapterCredentials
  ) {}

  get hasSession(): boolean {
    return this.stok !== null && Date.now() < this.stokExpiresAt;
  }

  /** For tests/inspection only — never send externally. */
  private peekStok(): string | null {
    return this.stok;
  }

  private async raw(spec: RouterOperationSpec, body?: Record<string, string>): Promise<RouterTransportResponse> {
    return this.transport.request({
      operation: spec.id,
      path: resolvePath(spec, this.hasSession ? this.stok : null),
      method: spec.method,
      body: body as never,
      timeoutMs: 5_000
    });
  }

  /** Login to the router and cache the stok in memory. */
  async login(): Promise<LoginResult> {
    // MiWiFi firmware login requires a key+nonce challenge (both encrypt
    // modes per upstream reference): password is never sent plaintext.
    // key:   scraped from GET /cgi-bin/luci/web (`key: '...'` in the page)
    // nonce: `${type}_${deviceId}_${unixSeconds}_${random}`
    // hash:  SHA256(nonce + SHA256(password + key))  (newEncryptMode)
    //        SHA1(nonce + SHA1(password + key))      (legacy)
    try {
      const key = await this.fetchLoginKey();
      if (key === null) {
        return { ok: false, reason: 'router_offline' };
      }
      const nonce = `0_${key.deviceId}_${Math.floor(Date.now() / 1000)}_${Math.floor(Math.random() * 10000)}`;
      const algorithm = key.newEncryptMode ? 'sha256' : 'sha1';
      const passwordHash = hashPasswordChallenge(
        algorithm,
        nonce,
        this.credentials.password,
        key.key
      );

      const response = await this.transport.request({
        operation: specFor('login').id,
        path: specFor('login').path,
        method: 'POST',
        body: {
          username: this.credentials.username,
          password: passwordHash,
          logtype: '2',
          nonce
        },
        timeoutMs: 5_000
      });
      return this.consumeLoginResponse(response);
    } catch (error) {
      if (error instanceof RouterTransportError) {
        if (error.failure.kind === 'offline' || error.failure.kind === 'timeout') {
          return { ok: false, reason: 'router_offline' };
        }
        return { ok: false, reason: 'malformed_response' };
      }
      throw error;
    }
  }

  /**
   * Fetch the login key + deviceId from the router's web page.
   * Returns null when unreachable (mapped to router_offline).
   */
  private async fetchLoginKey(): Promise<{
    key: string;
    deviceId: string;
    newEncryptMode: boolean;
  } | null> {
    const spec = specFor('loginPage');
    try {
      const response = await this.transport.request({
        operation: spec.id,
        path: spec.path,
        method: 'GET',
        timeoutMs: 5_000
      });
      if (response.status !== 200) return null;
      const html = String(response.body ?? '');
      // deviceId is typically the router MAC (colon-separated hex).
      const keyMatch = /key:\s*['"]([0-9a-f]+)['"]/.exec(html);
      const deviceMatch = /deviceId\s*=\s*['"]([0-9A-Za-z:-]+)['"]/.exec(html);
      const encryptMatch = /newEncryptMode\s*:\s*["']?(\d)/.exec(html);
      // Fall back to init_info for newEncryptMode when the page lacks it.
      let newEncryptMode = encryptMatch?.[1] === '1';
      if (encryptMatch === null) {
        const init = await this.readIdentity();
        newEncryptMode = init?.newEncryptMode === true;
      }
      if (!keyMatch?.[1] || !deviceMatch?.[1]) {
        return null;
      }
      return {
        key: keyMatch[1],
        deviceId: deviceMatch[1],
        newEncryptMode
      };
    } catch (error) {
      if (error instanceof RouterTransportError) {
        return null;
      }
      throw error;
    }
  }

  private consumeLoginResponse(response: RouterTransportResponse): LoginResult {
    if (response.status !== 200) {
      return { ok: false, reason: 'invalid_credentials' };
    }
    const body = response.body as { code?: number; token?: string; url?: string };
    // MiWiFi convention: code 0 + token, or a redirect url containing stok.
    if (typeof body?.token === 'string' && body.token.length > 0) {
      this.stok = body.token;
      this.stokExpiresAt = Date.now() + MiWifiAdapter.STOK_TTL_MS;
      return { ok: true };
    }
    if (typeof body?.url === 'string') {
      const match = /;stok=([A-Za-z0-9]+)/.exec(body.url);
      if (match?.[1]) {
        this.stok = match[1];
        this.stokExpiresAt = Date.now() + MiWifiAdapter.STOK_TTL_MS;
        return { ok: true };
      }
    }
    if (body?.code !== undefined && body.code !== 0) {
      return { ok: false, reason: 'invalid_credentials' };
    }
    return { ok: false, reason: 'malformed_response' };
  }

  /** Ensure a session exists; renew transparently via credentials. */
  async ensureSession(): Promise<boolean> {
    if (this.hasSession) return true;
    const result = await this.login();
    return result.ok;
  }

  /** Drop the cached session (e.g. after detected expiry). */
  invalidateSession(): void {
    this.stok = null;
    this.stokExpiresAt = 0;
  }

  /** Read the router identity without a session (init_info). */
  async readIdentity(): Promise<RouterIdentity | null> {
    const spec = specFor('initInfo');
    try {
      const response = await this.raw(spec);
      if (response.status !== 200) return null;
      const body = response.body as Record<string, unknown>;
      if (body === null || typeof body !== 'object') return null;
      return {
        model: typeof body.model === 'string' ? body.model : undefined,
        hardware: typeof body.hardware === 'string' ? body.hardware : undefined,
        // Firmwares expose romVersion or romversion (lowercase).
        romVersion:
          (typeof body.romVersion === 'string' ? body.romVersion : undefined) ??
          (typeof body.romversion === 'string' ? body.romversion : undefined),
        channel: typeof body.countrycode === 'string' ? body.countrycode : undefined,
        // Login challenge mode: 1 => SHA256, 0/absent => SHA1 (legacy).
        newEncryptMode: body.newEncryptMode === 1 || body.newEncryptMode === '1'
      };
    } catch (error) {
      if (error instanceof RouterTransportError) return null;
      throw error;
    }
  }

  /**
   * Read-only compatibility probe. Favors read-only operations; performs
   * login (required to test minimum protocol behavior), then probes
   * capability endpoints and classifies support.
   */
  async probe(): Promise<ProbeResult> {
    // 1. Offline / protocol check via unauthenticated init_info.
    const identity = await this.readIdentity();
    if (identity === null) {
      return {
        identity: { model: undefined, hardware: undefined, romVersion: undefined, channel: undefined, newEncryptMode: false },
        status: 'INCOMPATIBLE',
        capabilities: [],
        authenticated: false
      };
    }

    // 2. Minimum required behavior: login must succeed.
    const login = await this.login();
    if (!login.ok) {
      if (login.reason === 'invalid_credentials') {
        return { identity, status: 'INCOMPATIBLE', capabilities: [], authenticated: false };
      }
      if (login.reason === 'router_offline') {
        return { identity, status: 'UNKNOWN', capabilities: [], authenticated: false };
      }
      return { identity, status: 'INCOMPATIBLE', capabilities: [], authenticated: false };
    }

    // 3. Probe each capability endpoint (read-only ops only).
    const capabilities: RouterCapability[] = [];
    const probeOrder: { key: OperationKey; capability: RouterCapability }[] = [
      { key: 'status', capability: 'health-metrics' },
      { key: 'deviceList', capability: 'device-inventory' },
      { key: 'wanInfo', capability: 'router-info' }
    ];
    for (const { key, capability } of probeOrder) {
      if (!isRouterCapability(capability)) continue;
      const spec = specFor(key);
      if (spec.effect !== 'READ') continue; // probe is read-only only
      try {
        const response = await this.raw(spec);
        if (response.status === 200 && this.isBodyUsable(response.body)) {
          capabilities.push(capability);
        } else if (key === 'status') {
          try {
            const fallback = await this.raw(specFor('xqsystemStatus'));
            if (fallback.status === 200 && this.isBodyUsable(fallback.body)) {
              capabilities.push(capability);
            }
          } catch {
            // fallback unavailable
          }
        }
      } catch {
        if (key === 'status') {
          try {
            const fallback = await this.raw(specFor('xqsystemStatus'));
            if (fallback.status === 200 && this.isBodyUsable(fallback.body)) {
              capabilities.push(capability);
            }
          } catch {
            // endpoint unavailable — capability simply not recorded
          }
        }
      }
    }

    // 4. Classify.
    const hasHealth = capabilities.includes('health-metrics');
    const hasDevices = capabilities.includes('device-inventory');
    let status: RouterCompatibilityStatus;
    if (hasHealth && hasDevices) {
      status = 'SUPPORTED';
    } else if (hasHealth || hasDevices) {
      status = 'PARTIAL';
    } else {
      // Login works but no expected endpoints responded — usable but poor.
      status = 'PARTIAL';
    }
    return { identity, status, capabilities, authenticated: true };
  }

  private isBodyUsable(body: unknown): boolean {
    return body !== null && typeof body === 'object';
  }

  /** Execute an arbitrary catalog operation (session enforced). */
  async call(key: OperationKey, body?: Record<string, string>): Promise<RouterTransportResponse> {
    const invoke = async (k: OperationKey): Promise<RouterTransportResponse> => {
      const spec = specFor(k);
      if (spec.requiresStok && !(await this.ensureSession())) {
        throw new RouterTransportError({ kind: 'aborted' }, spec.id);
      }
      let response: RouterTransportResponse;
      try {
        response = await this.raw(spec, body);
      } catch (error) {
        if (
          error instanceof RouterTransportError &&
          error.failure.kind === 'http-status' &&
          (error.failure.status === 302 || error.failure.status === 401 || error.failure.status === 403)
        ) {
          this.invalidateSession();
        }
        throw error;
      }
      // MiWiFi signals session expiry via code 9 or redirect to login.
      const asObj = response.body as { code?: number } | null;
      if (typeof asObj === 'object' && asObj !== null && asObj.code === 9) {
        this.invalidateSession();
        throw new RouterTransportError({ kind: 'aborted' }, spec.id);
      }
      return response;
    };

    try {
      const response = await invoke(key);
      if (key === 'status' && (response.status === 404 || response.status === 501)) {
        try {
          const fallback = await invoke('xqsystemStatus');
          if (fallback.status === 200) return fallback;
        } catch {
          // ignore fallback failure, return original response
        }
      }
      return response;
    } catch (error) {
      if (
        key === 'status' &&
        error instanceof RouterTransportError &&
        error.failure.kind === 'http-status' &&
        (error.failure.status === 404 || error.failure.status === 501)
      ) {
        try {
          return await invoke('xqsystemStatus');
        } catch {
          throw error;
        }
      }
      throw error;
    }
  }
}
