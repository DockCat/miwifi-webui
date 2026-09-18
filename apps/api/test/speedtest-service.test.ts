import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SpeedtestService } from '../src/speedtest/service.js';
import { SpeedtestScheduler } from '../src/speedtest/scheduler.js';
import { loadSpeedtestConfig } from '../src/speedtest/config.js';
import { EventBridge } from '../src/observability/event-bridge.js';
import type { SpeedtestExecutionResult, SpeedtestProvider } from '../src/speedtest/types.js';
import type { SpeedtestResultDTO } from '@miwifi-webui/contracts';

class MockSpeedtestRepository {
  public results: SpeedtestResultDTO[] = [];

  async insertResult(data: Omit<SpeedtestResultDTO, 'id' | 'createdAt'>): Promise<SpeedtestResultDTO> {
    const result: SpeedtestResultDTO = {
      ...data,
      id: `res-${this.results.length + 1}`,
      createdAt: new Date().toISOString()
    };
    this.results.unshift(result);
    return result;
  }

  async getLatest(): Promise<SpeedtestResultDTO | null> {
    return this.results[0] ?? null;
  }

  async getHistory(limit = 10): Promise<SpeedtestResultDTO[]> {
    return this.results.slice(0, limit);
  }

  async purgeOlderThan(days: number): Promise<number> {
    return 0;
  }
}

class DelayedMockProvider implements SpeedtestProvider {
  constructor(
    readonly name: 'cloudflare',
    private readonly delayMs: number = 20
  ) {}

  async run(): Promise<SpeedtestExecutionResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return {
      downloadBps: 150_000_000,
      uploadBps: 30_000_000,
      pingMs: 10,
      jitterMs: 1,
      provider: 'cloudflare',
      source: 'backend',
      status: 'completed'
    };
  }
}

describe('Seam 2: Speedtest Config', () => {
  it('loads defaults when environment variables are unset', () => {
    delete process.env.SPEEDTEST_ENABLED;
    delete process.env.SPEEDTEST_INTERVAL_MINUTES;
    delete process.env.SPEEDTEST_DEFAULT_PROVIDER;

    const config = loadSpeedtestConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.intervalMinutes, 30);
    assert.equal(config.defaultProvider, 'auto');
    assert.equal(config.downloadBytes, 50_000_000);
    assert.equal(config.uploadBytes, 20_000_000);
    assert.equal(config.mlabDurationSeconds, 5);
  });

  it('parses custom environment variables properly', () => {
    process.env.SPEEDTEST_ENABLED = 'false';
    process.env.SPEEDTEST_INTERVAL_MINUTES = '60';
    process.env.SPEEDTEST_DEFAULT_PROVIDER = 'mlab';
    process.env.SPEEDTEST_DOWNLOAD_BYTES = '100000000';
    process.env.SPEEDTEST_UPLOAD_BYTES = '30000000';
    process.env.SPEEDTEST_MLAB_DURATION_SECONDS = '10';

    const config = loadSpeedtestConfig();
    assert.equal(config.enabled, false);
    assert.equal(config.intervalMinutes, 60);
    assert.equal(config.defaultProvider, 'mlab');
    assert.equal(config.downloadBytes, 100_000_000);
    assert.equal(config.uploadBytes, 30_000_000);
    assert.equal(config.mlabDurationSeconds, 10);

    delete process.env.SPEEDTEST_ENABLED;
    delete process.env.SPEEDTEST_INTERVAL_MINUTES;
    delete process.env.SPEEDTEST_DEFAULT_PROVIDER;
    delete process.env.SPEEDTEST_DOWNLOAD_BYTES;
    delete process.env.SPEEDTEST_UPLOAD_BYTES;
    delete process.env.SPEEDTEST_MLAB_DURATION_SECONDS;
  });
});

describe('Seam 2: SpeedtestService Concurrency & Execution Lock', () => {
  it('enforces single-flight lock: concurrent run throws/returns conflict', async () => {
    const repo = new MockSpeedtestRepository();
    const events = new EventBridge();
    const provider = new DelayedMockProvider('cloudflare', 50);

    const service = new SpeedtestService({
      repository: repo as never,
      events,
      createProvider: () => provider
    });

    const promise1 = service.runTest({ provider: 'cloudflare', triggeredBy: 'manual' });
    assert.equal(service.isRunning, true);

    await assert.rejects(
      () => service.runTest({ provider: 'cloudflare', triggeredBy: 'manual' }),
      { message: 'A speedtest is already in progress' }
    );

    const result1 = await promise1;
    assert.equal(service.isRunning, false);
    assert.equal(result1.status, 'completed');
  });

  it('publishes SSE events when test begins and completes', async () => {
    const repo = new MockSpeedtestRepository();
    const events = new EventBridge();
    const emittedEvents: string[] = [];

    events.subscribe((event) => {
      emittedEvents.push(event.type);
    });

    const service = new SpeedtestService({
      repository: repo as never,
      events,
      createProvider: () => new DelayedMockProvider('cloudflare', 10)
    });

    await service.runTest({ provider: 'cloudflare', triggeredBy: 'manual' });

    assert.ok(emittedEvents.includes('speedtest-start'));
    assert.ok(emittedEvents.includes('speedtest-complete'));
  });
});

describe('Seam 2: SpeedtestScheduler', () => {
  it('starts and stops timers cleanly', () => {
    const repo = new MockSpeedtestRepository();
    const events = new EventBridge();
    const service = new SpeedtestService({
      repository: repo as never,
      events,
      createProvider: () => new DelayedMockProvider('cloudflare', 5)
    });

    const scheduler = new SpeedtestScheduler(service, {
      enabled: true,
      intervalMinutes: 30,
      defaultProvider: 'auto',
      downloadBytes: 50_000_000,
      uploadBytes: 20_000_000,
      mlabDurationSeconds: 5
    });

    scheduler.start();
    assert.equal(scheduler.isScheduled, true);
    scheduler.stop();
    assert.equal(scheduler.isScheduled, false);
  });

  it('does not schedule periodic runs when intervalMinutes is 0', () => {
    const repo = new MockSpeedtestRepository();
    const events = new EventBridge();
    const service = new SpeedtestService({
      repository: repo as never,
      events,
      createProvider: () => new DelayedMockProvider('cloudflare', 5)
    });

    const scheduler = new SpeedtestScheduler(service, {
      enabled: true,
      intervalMinutes: 0,
      defaultProvider: 'auto',
      downloadBytes: 50_000_000,
      uploadBytes: 20_000_000,
      mlabDurationSeconds: 5
    });

    scheduler.start();
    assert.equal(scheduler.isScheduled, false);
    scheduler.stop();
  });
});
