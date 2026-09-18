import type { MiWifiAdapter } from '@miwifi-webui/router-core';
import type { SpeedtestExecutionResult, SpeedtestProvider } from '../types.js';

export class AutoSpeedtestProvider implements SpeedtestProvider {
  readonly name = 'auto' as const;

  constructor(
    private readonly routerAdapter: MiWifiAdapter | null,
    private readonly primaryBackend: SpeedtestProvider,
    private readonly secondaryBackend?: SpeedtestProvider
  ) {}

  async run(): Promise<SpeedtestExecutionResult> {
    // 1. Attempt router-side bandwidth test first if adapter is present
    if (this.routerAdapter) {
      try {
        const res = await this.routerAdapter.call('bandwidthTest');
        if (res.status === 200 && res.body && typeof res.body === 'object') {
          const body = res.body as Record<string, unknown>;
          if (body['code'] === 0 && body['bandwidth'] && typeof body['bandwidth'] === 'object') {
            const bw = body['bandwidth'] as Record<string, unknown>;
            const downBytesPerSec = Number(bw['down']) || 0;
            const upBytesPerSec = Number(bw['up']) || 0;
            const rtt = Number(bw['rtt']) || 0;

            if (downBytesPerSec > 0 || upBytesPerSec > 0) {
              return {
                downloadBps: Math.round(downBytesPerSec * 8),
                uploadBps: Math.round(upBytesPerSec * 8),
                pingMs: rtt,
                jitterMs: 0,
                provider: 'auto',
                source: 'router',
                status: 'completed',
                errorMessage: null
              };
            }
          }
        }
      } catch {
        // Router bandwidthTest endpoint failed or unsupported; smoothly fall through to backend
      }
    }

    // 2. Primary backend speedtest runner (e.g. M-Lab)
    const primaryResult = await this.primaryBackend.run();
    if (primaryResult.status === 'completed' || !this.secondaryBackend) {
      return {
        ...primaryResult,
        provider: 'auto',
        source: 'backend'
      };
    }

    // 3. Fallback to secondary backend runner if primary failed (e.g. Cloudflare)
    const secondaryResult = await this.secondaryBackend.run();
    return {
      ...secondaryResult,
      provider: 'auto',
      source: 'backend'
    };
  }
}
