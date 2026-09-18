import type {
  SpeedtestProviderType,
  SpeedtestResultDTO
} from '@miwifi-webui/contracts';
import type { EventBridge } from '../observability/event-bridge.js';
import type { SpeedtestRepository } from './repository.js';
import type { SpeedtestProvider } from './types.js';
import { CloudflareSpeedtestProvider } from './providers/cloudflare.js';
import { MlabSpeedtestProvider } from './providers/mlab.js';
import { FastSpeedtestProvider } from './providers/fast.js';
import { AutoSpeedtestProvider } from './providers/auto.js';
import type { MiWifiAdapter } from '@miwifi-webui/router-core';

export interface SpeedtestServiceOptions {
  readonly repository: SpeedtestRepository;
  readonly events: EventBridge;
  readonly getRouterAdapter?: (routerId?: string) => MiWifiAdapter | null;
  readonly createProvider?: (providerType: SpeedtestProviderType, routerId?: string) => SpeedtestProvider;
  readonly downloadBytes?: number;
  readonly uploadBytes?: number;
  readonly mlabDurationSeconds?: number;
}

export class SpeedtestService {
  private running = false;
  private readonly repository: SpeedtestRepository;
  private readonly events: EventBridge;
  private readonly getRouterAdapter?: (routerId?: string) => MiWifiAdapter | null;
  private readonly createProviderFn?: (
    providerType: SpeedtestProviderType,
    routerId?: string
  ) => SpeedtestProvider;
  private readonly downloadBytes?: number;
  private readonly uploadBytes?: number;
  private readonly mlabDurationSeconds?: number;

  constructor(options: SpeedtestServiceOptions) {
    this.repository = options.repository;
    this.events = options.events;
    this.getRouterAdapter = options.getRouterAdapter;
    this.createProviderFn = options.createProvider;
    this.downloadBytes = options.downloadBytes;
    this.uploadBytes = options.uploadBytes;
    this.mlabDurationSeconds = options.mlabDurationSeconds;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async runTest(options: {
    provider?: SpeedtestProviderType;
    triggeredBy: 'manual' | 'scheduled';
    routerId?: string;
  }): Promise<SpeedtestResultDTO> {
    if (this.running) {
      throw new Error('A speedtest is already in progress');
    }

    this.running = true;
    const providerType = options.provider ?? 'auto';

    this.events.publish('speedtest-start', {
      provider: providerType,
      triggeredBy: options.triggeredBy,
      routerId: options.routerId ?? null
    });

    try {
      const provider = this.resolveProvider(providerType, options.routerId);
      const executionResult = await provider.run();

      const savedResult = await this.repository.insertResult({
        routerId: options.routerId ?? null,
        downloadBps: executionResult.downloadBps,
        uploadBps: executionResult.uploadBps,
        pingMs: executionResult.pingMs,
        jitterMs: executionResult.jitterMs,
        provider: executionResult.provider,
        source: executionResult.source,
        triggeredBy: options.triggeredBy,
        status: executionResult.status,
        errorMessage: executionResult.errorMessage
      });

      this.events.publish('speedtest-complete', savedResult as unknown as Record<string, unknown>);
      return savedResult;
    } finally {
      this.running = false;
    }
  }

  async getLatest(routerId?: string): Promise<SpeedtestResultDTO | null> {
    return this.repository.getLatest(routerId);
  }

  async getHistory(
    limit = 10,
    routerId?: string,
    since?: Date
  ): Promise<SpeedtestResultDTO[]> {
    return this.repository.getHistory(limit, routerId, since);
  }

  private resolveProvider(
    providerType: SpeedtestProviderType,
    routerId?: string
  ): SpeedtestProvider {
    if (this.createProviderFn) {
      return this.createProviderFn(providerType, routerId);
    }

    if (providerType === 'fast') {
      return new FastSpeedtestProvider();
    }

    if (providerType === 'mlab') {
      return new MlabSpeedtestProvider({
        durationSeconds: this.mlabDurationSeconds
      });
    }

    if (providerType === 'cloudflare') {
      return new CloudflareSpeedtestProvider({
        downloadBytes: this.downloadBytes,
        uploadBytes: this.uploadBytes
      });
    }

    // Default 'auto': router first with mlab fallback, then cloudflare fallback
    const adapter = this.getRouterAdapter ? this.getRouterAdapter(routerId) : null;
    const mlab = new MlabSpeedtestProvider({
      durationSeconds: this.mlabDurationSeconds
    });
    const cloudflare = new CloudflareSpeedtestProvider({
      downloadBytes: this.downloadBytes,
      uploadBytes: this.uploadBytes
    });
    return new AutoSpeedtestProvider(adapter, mlab, cloudflare);
  }
}
