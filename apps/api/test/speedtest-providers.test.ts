import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CloudflareSpeedtestProvider } from '../src/speedtest/providers/cloudflare.js';
import { FastSpeedtestProvider } from '../src/speedtest/providers/fast.js';
import { AutoSpeedtestProvider } from '../src/speedtest/providers/auto.js';

describe('Seam 1: CloudflareSpeedtestProvider', () => {
  it('measures latency, download and upload speeds via mock fetch', async () => {
    let callCount = 0;
    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      callCount++;
      const urlStr = String(url);
      if (urlStr.includes('__down?bytes=0')) {
        // Latency probe
        return new Response('', { status: 200 });
      }
      if (urlStr.includes('__down?bytes=')) {
        // Download probe: 1,000,000 bytes chunk
        const chunk = new Uint8Array(1_000_000);
        return new Response(chunk, { status: 200 });
      }
      if (urlStr.includes('__up')) {
        // Upload probe
        return new Response('ok', { status: 200 });
      }
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const provider = new CloudflareSpeedtestProvider({ fetchFn: mockFetch });
    const result = await provider.run();

    assert.equal(result.provider, 'cloudflare');
    assert.equal(result.source, 'backend');
    assert.equal(result.status, 'completed');
    assert.ok(result.downloadBps > 0, 'downloadBps should be positive');
    assert.ok(result.uploadBps >= 0, 'uploadBps should be non-negative');
    assert.ok(result.pingMs >= 0, 'pingMs should be non-negative');
    assert.ok(result.jitterMs >= 0, 'jitterMs should be non-negative');
  });

  it('fails safely with descriptive message when fetch fails', async () => {
    const mockFetch = (async () => {
      throw new Error('Network timeout');
    }) as typeof fetch;

    const provider = new CloudflareSpeedtestProvider({ fetchFn: mockFetch });
    const result = await provider.run();

    assert.equal(result.provider, 'cloudflare');
    assert.equal(result.source, 'backend');
    assert.equal(result.status, 'failed');
    assert.ok(result.errorMessage?.includes('Network timeout'));
  });
});

describe('Seam 1: FastSpeedtestProvider', () => {
  it('measures download and latency via mock fast endpoints', async () => {
    const mockFetch = (async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === 'fast.com' || parsed.hostname === 'api.fast.com') {
        return new Response(new Uint8Array(500_000), { status: 200 });
      }
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const provider = new FastSpeedtestProvider({ fetchFn: mockFetch });
    const result = await provider.run();

    assert.equal(result.provider, 'fast');
    assert.equal(result.source, 'backend');
    assert.equal(result.status, 'completed');
    assert.ok(result.downloadBps > 0);
  });
});

describe('Seam 1: AutoSpeedtestProvider (Router first with fallback)', () => {
  it('uses router speedtest when router adapter succeeds', async () => {
    const mockRouterAdapter = {
      call: async (key: string) => {
        assert.equal(key, 'bandwidthTest');
        return {
          status: 200,
          body: {
            code: 0,
            bandwidth: {
              down: 12500000, // 100 Mbps in bytes/s
              up: 2500000,
              rtt: 15
            }
          }
        };
      }
    };

    const mockBackend = new CloudflareSpeedtestProvider();
    const provider = new AutoSpeedtestProvider(mockRouterAdapter as never, mockBackend);
    const result = await provider.run();

    assert.equal(result.provider, 'auto');
    assert.equal(result.source, 'router');
    assert.equal(result.status, 'completed');
    assert.equal(result.downloadBps, 100_000_000); // 12.5 MB/s * 8
    assert.equal(result.uploadBps, 20_000_000);
    assert.equal(result.pingMs, 15);
  });

  it('falls back to backend provider when router reports error or unsupported', async () => {
    const mockRouterAdapter = {
      call: async () => {
        throw new Error('404 Not Found - endpoint unsupported');
      }
    };

    const mockBackend = {
      run: async () => ({
        downloadBps: 80_000_000,
        uploadBps: 10_000_000,
        pingMs: 12,
        jitterMs: 2,
        provider: 'cloudflare' as const,
        source: 'backend' as const,
        status: 'completed' as const
      })
    };

    const provider = new AutoSpeedtestProvider(mockRouterAdapter as never, mockBackend as never);
    const result = await provider.run();

    assert.equal(result.provider, 'auto');
    assert.equal(result.source, 'backend');
    assert.equal(result.status, 'completed');
    assert.equal(result.downloadBps, 80_000_000);
  });

  it('falls back to backend provider when router returns non-zero code', async () => {
    const mockRouterAdapter = {
      call: async () => ({
        status: 200,
        body: { code: 1523, msg: 'Speedtest server unreachable' }
      })
    };

    const mockBackend = {
      run: async () => ({
        downloadBps: 60_000_000,
        uploadBps: 15_000_000,
        pingMs: 20,
        jitterMs: 3,
        provider: 'cloudflare' as const,
        source: 'backend' as const,
        status: 'completed' as const
      })
    };

    const provider = new AutoSpeedtestProvider(mockRouterAdapter as never, mockBackend as never);
    const result = await provider.run();

    assert.equal(result.provider, 'auto');
    assert.equal(result.source, 'backend');
    assert.equal(result.status, 'completed');
    assert.equal(result.downloadBps, 60_000_000);
  });
});
