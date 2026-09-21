import type { SpeedtestExecutionResult, SpeedtestProvider } from '../types.js';

export interface MlabProviderOptions {
  readonly fetchFn?: typeof fetch;
  readonly webSocketFactory?: (url: string, protocols?: string | string[]) => WebSocket;
  readonly locateUrl?: string;
  readonly durationSeconds?: number;
  readonly timeoutMs?: number;
}

interface MlabLocateServer {
  readonly machine?: string;
  readonly hostname?: string;
  readonly urls: Record<string, string>;
}

interface MlabLocateResponse {
  readonly results?: MlabLocateServer[];
}

export class MlabSpeedtestProvider implements SpeedtestProvider {
  readonly name = 'mlab' as const;
  private readonly fetchFn: typeof fetch;
  private readonly createWebSocket: (url: string, protocols?: string | string[]) => WebSocket;
  private readonly locateUrl: string;
  private readonly durationSeconds: number;
  private readonly timeoutMs: number;

  constructor(options: MlabProviderOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.createWebSocket = options.webSocketFactory ?? ((url, proto) => new WebSocket(url, proto));
    this.locateUrl = options.locateUrl ?? 'https://locate.measurementlab.net/v2/nearest/ndt/ndt7';
    this.durationSeconds = Math.max(2, Math.min(30, options.durationSeconds ?? 5));
    this.timeoutMs = options.timeoutMs ?? (this.durationSeconds * 2 + 10) * 1000;
  }

  async run(): Promise<SpeedtestExecutionResult> {
    try {
      // 1. Locate nearest M-Lab NDT7 server
      const { downloadUrl, uploadUrl, pingEstimateMs } = await this.locateNearestServer();

      // 2. Measure Download via WebSocket
      const { downloadBps, downloadPingMs } = await this.measureDownload(downloadUrl);

      // 3. Measure Upload via WebSocket
      const uploadBps = await this.measureUpload(uploadUrl);

      const pingMs = downloadPingMs > 0 ? downloadPingMs : pingEstimateMs;

      return {
        downloadBps,
        uploadBps,
        pingMs,
        jitterMs: 0,
        provider: 'mlab',
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
        provider: 'mlab',
        source: 'backend',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async locateNearestServer(): Promise<{ downloadUrl: string; uploadUrl: string; pingEstimateMs: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    const start = performance.now();

    try {
      const res = await this.fetchFn(this.locateUrl, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`M-Lab locate returned status ${res.status}`);
      }
      const data = (await res.json()) as MlabLocateResponse;
      const server = data.results?.[0];
      if (!server || !server.urls) {
        throw new Error('M-Lab locate returned no available servers');
      }

      const downloadUrl = server.urls['wss:///ndt/v7/download'] ?? server.urls['ws:///ndt/v7/download'];
      const uploadUrl = server.urls['wss:///ndt/v7/upload'] ?? server.urls['ws:///ndt/v7/upload'];

      if (!downloadUrl || !uploadUrl) {
        throw new Error('M-Lab locate missing NDT7 WebSocket URLs');
      }

      const pingEstimateMs = Math.max(1, Math.round(performance.now() - start));
      return { downloadUrl, uploadUrl, pingEstimateMs };
    } finally {
      clearTimeout(timeout);
    }
  }

  private measureDownload(url: string): Promise<{ downloadBps: number; downloadPingMs: number }> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = this.createWebSocket(url, 'net.measurementlab.ndt.v7');
      } catch (err) {
        return reject(err);
      }

      ws.binaryType = 'arraybuffer';
      const connectStart = performance.now();
      let transferStart = 0;
      let totalBytes = 0;
      let downloadPingMs = 0;
      let timer: NodeJS.Timeout | null = null;
      let safetyTimeout: NodeJS.Timeout | null = null;
      let settled = false;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (safetyTimeout) clearTimeout(safetyTimeout);
        try {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch {
          // Ignore close errors
        }
      };

      safetyTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('M-Lab download test timed out'));
        }
      }, (this.durationSeconds + 5) * 1000);

      ws.onopen = () => {
        downloadPingMs = Math.max(1, Math.round(performance.now() - connectStart));
        transferStart = performance.now();

        timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            const elapsed = Math.max(0.1, (performance.now() - transferStart) / 1000);
            const downloadBps = Math.round((totalBytes * 8) / elapsed);
            cleanup();
            resolve({ downloadBps, downloadPingMs });
          }
        }, this.durationSeconds * 1000);
      };

      ws.onmessage = (evt) => {
        if (typeof evt.data === 'string') {
          // JSON metadata messages from NDT7 server
        } else if (evt.data) {
          const byteLen = (evt.data as ArrayBuffer).byteLength ?? (evt.data as Uint8Array).length ?? 0;
          totalBytes += byteLen;
        }
      };

      ws.onerror = (err) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(`WebSocket error during M-Lab download: ${String(err)}`));
        }
      };

      ws.onclose = () => {
        if (!settled) {
          settled = true;
          cleanup();
          const elapsed = transferStart > 0 ? Math.max(0.1, (performance.now() - transferStart) / 1000) : 1;
          const downloadBps = Math.round((totalBytes * 8) / elapsed);
          resolve({ downloadBps, downloadPingMs });
        }
      };
    });
  }

  private measureUpload(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = this.createWebSocket(url, 'net.measurementlab.ndt.v7');
      } catch (err) {
        return reject(err);
      }

      let totalBytesSent = 0;
      let transferStart = 0;
      const chunkSize = 64 * 1024; // 64KB chunks
      const chunk = new Uint8Array(chunkSize);
      let pumpInterval: NodeJS.Timeout | null = null;
      let timer: NodeJS.Timeout | null = null;
      let safetyTimeout: NodeJS.Timeout | null = null;
      let settled = false;

      const cleanup = () => {
        if (pumpInterval) clearInterval(pumpInterval);
        if (timer) clearTimeout(timer);
        if (safetyTimeout) clearTimeout(safetyTimeout);
        try {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch {
          // Ignore close errors
        }
      };

      safetyTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('M-Lab upload test timed out'));
        }
      }, (this.durationSeconds + 5) * 1000);

      ws.onopen = () => {
        transferStart = performance.now();

        const pump = () => {
          let sentThisTick = 0;
          while (
            ws.readyState === WebSocket.OPEN &&
            ws.bufferedAmount < 1024 * 1024 &&
            sentThisTick < 1024 * 1024
          ) {
            ws.send(chunk);
            totalBytesSent += chunkSize;
            sentThisTick += chunkSize;
          }
        };

        pump();
        pumpInterval = setInterval(pump, 5);

        timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            const elapsed = Math.max(0.1, (performance.now() - transferStart) / 1000);
            const uploadBps = Math.round((totalBytesSent * 8) / elapsed);
            cleanup();
            resolve(uploadBps);
          }
        }, this.durationSeconds * 1000);
      };

      ws.onerror = (err) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(`WebSocket error during M-Lab upload: ${String(err)}`));
        }
      };

      ws.onclose = () => {
        if (!settled) {
          settled = true;
          cleanup();
          const elapsed = transferStart > 0 ? Math.max(0.1, (performance.now() - transferStart) / 1000) : 1;
          const uploadBps = Math.round((totalBytesSent * 8) / elapsed);
          resolve(uploadBps);
        }
      };
    });
  }
}
