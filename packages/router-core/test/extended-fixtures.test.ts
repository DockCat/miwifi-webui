/**
 * Extended compatibility fixtures (Task 0008): login response variants
 * (token body vs redirect-url stok), mid-call session expiry with
 * transparent renewal, malformed status payloads.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FixtureTransport,
  MiWifiAdapter,
  RouterTransportError,
  type FixtureScenario,
  type RouterTransport,
  type RouterTransportRequest,
  type RouterTransportResponse
} from '../src/index.js';

const CREDENTIALS = { username: 'admin', password: 'ExtFix-Pass-1' };

const LOGIN_PAGE_HTML =
  '<html><script>var deviceId = \'aa:bb:cc:dd:ee:03\'; key: \'c33ef77e22ff99b3c4d5e6f70821304\'</script></html>';

describe('login response variants', () => {
  it('parses stok from a redirect-style url field', async () => {
    // Some firmwares return { code: 0, url: "/cgi-bin/luci/api/stok=TOKEN/..." }
    const transport: RouterTransport = {
      request: async (req: RouterTransportRequest): Promise<RouterTransportResponse> => {
        if (req.operation === 'init_info') {
          return { status: 200, body: { code: 0, model: 'R3G' } };
        }
        if (req.operation === 'login_page') {
          return { status: 200, body: LOGIN_PAGE_HTML };
        }
        if (req.operation === 'login') {
          return {
            status: 200,
            body: {
              code: 0,
              url: '/cgi-bin/luci/;stok=RedirectToken9/web/home'
            }
          };
        }
        return { status: 200, body: { code: 0 } };
      }
    };
    const adapter = new MiWifiAdapter(transport, CREDENTIALS);
    const result = await adapter.login();
    assert.deepEqual(result, { ok: true });
    assert.equal(adapter.hasSession, true);
    // The adapter must use the parsed token for subsequent calls.
    const response = await adapter.call('status');
    assert.equal(response.status, 200);
  });

  it('rejects a login body with neither token nor url', async () => {
    const transport: RouterTransport = {
      request: async (req: RouterTransportRequest): Promise<RouterTransportResponse> => {
        if (req.operation === 'init_info') {
          return { status: 200, body: { code: 0, model: 'R3G' } };
        }
        if (req.operation === 'login_page') {
          return { status: 200, body: LOGIN_PAGE_HTML };
        }
        return { status: 200, body: { code: 0, msg: 'weird firmware' } };
      }
    };
    const adapter = new MiWifiAdapter(transport, CREDENTIALS);
    const result = await adapter.login();
    assert.deepEqual(result, { ok: false, reason: 'malformed_response' });
  });
});

describe('mid-session expiry', () => {
  it('expires the session and renews on the next ensureSession', async () => {
    let loginCount = 0;
    const transport: RouterTransport = {
      request: async (req: RouterTransportRequest): Promise<RouterTransportResponse> => {
        if (req.operation === 'login_page') {
          return { status: 200, body: LOGIN_PAGE_HTML };
        }
        if (req.operation === 'login') {
          loginCount++;
          return { status: 200, body: { code: 0, token: `token-${loginCount}` } };
        }
        if (loginCount < 2) {
          return { status: 200, body: { code: 9, msg: 'expired' } };
        }
        return { status: 200, body: { code: 0, cpu: 10 } };
      }
    };
    const adapter = new MiWifiAdapter(transport, CREDENTIALS);
    await adapter.login();
    // First call after "expiry" aborts (code 9).
    await assert.rejects(
      () => adapter.call('status'),
      (error: unknown) =>
        error instanceof RouterTransportError && error.failure.kind === 'aborted'
    );
    assert.equal(adapter.hasSession, false);
    // Renewal succeeds transparently.
    assert.equal(await adapter.ensureSession(), true);
    const response = await adapter.call('status');
    assert.equal((response.body as { cpu?: number }).cpu, 10);
  });

  it('invalidates session on http redirect (302) or 401 response', async () => {
    let callCount = 0;
    const transport: RouterTransport = {
      request: async (req: RouterTransportRequest): Promise<RouterTransportResponse> => {
        if (req.operation === 'init_info') {
          return { status: 200, body: { code: 0, model: 'R3G', newEncryptMode: 0 } };
        }
        if (req.operation === 'login_page') {
          return { status: 200, body: LOGIN_PAGE_HTML };
        }
        if (req.operation === 'login') {
          return { status: 200, body: { code: 0, token: 'valid-token' } };
        }
        callCount++;
        if (callCount === 1) {
          throw new RouterTransportError({ kind: 'http-status', status: 302 }, req.operation);
        }
        return { status: 200, body: { code: 0, cpu: 15 } };
      }
    };
    const adapter = new MiWifiAdapter(transport, CREDENTIALS);
    await adapter.login();
    assert.equal(adapter.hasSession, true);
    await assert.rejects(
      () => adapter.call('status'),
      (error: unknown) =>
        error instanceof RouterTransportError && error.failure.kind === 'http-status'
    );
    assert.equal(adapter.hasSession, false, 'session must be invalidated after 302 redirect');
  });
});

describe('fixture scenario library', () => {
  const SCENARIOS: FixtureScenario[] = [
    {
      name: 'full-support-token-login',
      initInfo: { code: 0, model: 'RD03' },
      loginPage: LOGIN_PAGE_HTML,
      login: { ok: true, token: 'tok' },
      responses: {
        status: { status: 200, body: { code: 0 } },
        device_list: { status: 200, body: { code: 0, list: [] } },
        wan_info: { status: 200, body: { code: 0 } }
      }
    },
    {
      name: 'auth-failure',
      initInfo: { code: 0, model: 'R4CM' },
      loginPage: LOGIN_PAGE_HTML,
      login: { ok: false, token: null },
      responses: {}
    },
    {
      name: 'malformed-status',
      initInfo: { code: 0, model: 'R3P' },
      loginPage: LOGIN_PAGE_HTML,
      login: { ok: true, token: 'tok' },
      responses: {
        status: { status: 200, body: 42 }
      }
    }
  ];

  it('probes classify the full library consistently', async () => {
    const results = [];
    for (const scenario of SCENARIOS) {
      const adapter = new MiWifiAdapter(new FixtureTransport(scenario), CREDENTIALS);
      results.push(await adapter.probe());
    }
    assert.equal(results[0]!.status, 'SUPPORTED');
    assert.equal(results[1]!.status, 'INCOMPATIBLE');
    // Malformed status body (42) is unusable -> capability not recorded.
    assert.ok(!results[2]!.capabilities.includes('health-metrics'));
  });
});
