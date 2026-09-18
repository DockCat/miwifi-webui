import type { SpeedtestExecutionResult, SpeedtestProvider } from '../types.js';

export interface CloudflareProviderOptions {
  readonly fetchFn?: typeof fetch;
  readonly latencySamples?: number;
  readonly downloadBytes?: number;
  readonly uploadBytes?: number;
  readonly timeoutMs?: number;
}

export class CloudflareSpeedtestProvider implements SpeedtestProvider {
  readonly name = 'cloudflare' as const;
  private readonly fetchFn: typeof fetch;
  private readonly latencySamples: number;
  private readonly downloadBytes: number;
  private readonly uploadBytes: number;
  private readonly timeoutMs: number;

  constructor(options: CloudflareProviderOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.latencySamples = options.latencySamples ?? 4;
    this.downloadBytes = options.downloadBytes ?? 50_000_000; // 50MB
    this.uploadBytes = options.uploadBytes ?? 20_000_000;     // 20MB
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async run(): Promise<SpeedtestExecutionResult> {
    try {
      // 1. Measure Latency & Jitter (with connection warm-up)
      const { pingMs, jitterMs } = await this.measureLatency();

      // 2. Measure Download Speed (pure transfer time from first byte)
      const downloadBps = await this.measureDownload();

      // 3. Measure Upload Speed (deducting 1 RTT server response time)
      const uploadBps = await this.measureUpload(pingMs);

      return {
        downloadBps,
        uploadBps,
        pingMs,
        jitterMs,
        provider: 'cloudflare',
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
        provider: 'cloudflare',
        source: 'backend',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async measureLatency(): Promise<{ pingMs: number; jitterMs: number }> {
    // Warm-up request to establish TCP+TLS connection before latency sampling
    try {
      const warmup = await this.fetchWithTimeout(
        'https://speed.cloudflare.com/__down?bytes=0',
        { method: 'GET' },
        3_000
      );
      await warmup.arrayBuffer();
    } catch {
      // Ignore warmup failures, sampling loop handles errors
    }

    const latencies: number[] = [];

    for (let i = 0; i < this.latencySamples; i++) {
      const start = performance.now();
      const res = await this.fetchWithTimeout(
        'https://speed.cloudflare.com/__down?bytes=0',
        { method: 'GET' },
        3_000
      );
      if (!res.ok) throw new Error(`Latency check returned status ${res.status}`);
      await res.arrayBuffer();
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
    }

    if (latencies.length === 0) return { pingMs: 0, jitterMs: 0 };

    const sum = latencies.reduce((acc, val) => acc + val, 0);
    const avg = sum / latencies.length;

    // Calculate jitter as average difference between consecutive latency measurements
    let jitterSum = 0;
    for (let i = 1; i < latencies.length; i++) {
      const curr = latencies[i];
      const prev = latencies[i - 1];
      if (curr !== undefined && prev !== undefined) {
        jitterSum += Math.abs(curr - prev);
      }
    }
    const jitter = latencies.length > 1 ? jitterSum / (latencies.length - 1) : 0;

    return {
      pingMs: Math.round(avg * 10) / 10,
      jitterMs: Math.round(jitter * 10) / 10
    };
  }

  private async measureDownload(): Promise<number> {
    const res = await this.fetchWithTimeout(
      `https://speed.cloudflare.com/__down?bytes=${this.downloadBytes}`,
      { method: 'GET' },
      this.timeoutMs
    );

    if (!res.ok) throw new Error(`Download test returned status ${res.status}`);

    let totalBytes = 0;
    let transferStart = performance.now();
    let firstChunk = true;

    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (firstChunk) {
            transferStart = performance.now();
            firstChunk = false;
          }
          totalBytes += value.byteLength;
        }
      }
    } else {
      transferStart = performance.now();
      const buffer = await res.arrayBuffer();
      totalBytes = buffer.byteLength;
    }

    const durationSeconds = Math.max(0.001, (performance.now() - transferStart) / 1000);
    return Math.round((totalBytes * 8) / durationSeconds);
  }

  private async measureUpload(pingMs = 0): Promise<number> {
    const data = new Uint8Array(this.uploadBytes);
    const start = performance.now();
    const res = await this.fetchWithTimeout(
      'https://speed.cloudflare.com/__up',
      {
        method: 'POST',
        body: data,
        headers: { 'Content-Type': 'application/octet-stream' }
      },
      this.timeoutMs
    );

    if (!res.ok) throw new Error(`Upload test returned status ${res.status}`);
    await res.text();

    const elapsed = (performance.now() - start) / 1000;
    // Deduct 1 RTT (pingMs) which accounts for the server response return trip after data upload
    const durationSeconds = Math.max(0.001, elapsed - (pingMs / 1000));
    return Math.round((this.uploadBytes * 8) / durationSeconds);
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
