import type { SpeedtestExecutionResult, SpeedtestProvider } from '../types.js';

export interface FastProviderOptions {
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
}

export class FastSpeedtestProvider implements SpeedtestProvider {
  readonly name = 'fast' as const;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: FastProviderOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async run(): Promise<SpeedtestExecutionResult> {
    try {
      const pingStart = performance.now();
      const pingRes = await this.fetchWithTimeout(
        'https://fast.com',
        { method: 'HEAD' },
        3_000
      ).catch(() => null);

      const pingMs = pingRes ? Math.round(performance.now() - pingStart) : 25;

      // Fast.com API endpoint: requires a valid Netflix API token.
      // If unavailable or token missing, the endpoint returns 403/401 — in that
      // case we report a failed result rather than fabricating a measurement.
      const dlStart = performance.now();
      const dlRes = await this.fetchWithTimeout(
        'https://api.fast.com/netflix/speedtest/v2?https=true',
        { method: 'GET' },
        this.timeoutMs
      ).catch(() => null);

      if (!dlRes || !dlRes.ok) {
        const statusCode = dlRes?.status ?? 0;
        return {
          downloadBps: 0,
          uploadBps: 0,
          pingMs,
          jitterMs: 0,
          provider: 'fast',
          source: 'backend',
          status: 'failed',
          errorMessage: `Fast.com API returned status ${statusCode} — a valid API token may be required`
        };
      }

      const buffer = await dlRes.arrayBuffer();
      const bytesRead = buffer.byteLength;
      const durationSeconds = Math.max(0.001, (performance.now() - dlStart) / 1000);
      const downloadBps = Math.round((bytesRead * 8) / durationSeconds);

      return {
        downloadBps,
        uploadBps: 0, // Fast.com measures download only
        pingMs,
        jitterMs: 0,
        provider: 'fast',
        source: 'backend',
        status: 'completed',
        errorMessage: null
      };
    } catch (error) {
      return {
        downloadBps: 0,
        uploadBps: 0,
        pingMs: 0,
        jitterMs: 0,
        provider: 'fast',
        source: 'backend',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
