import type { SpeedtestConfig } from './config.js';
import type { SpeedtestService } from './service.js';

export class SpeedtestScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: SpeedtestService,
    private readonly config: SpeedtestConfig
  ) {}

  get isScheduled(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (!this.config.enabled || this.config.intervalMinutes <= 0) {
      return;
    }

    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    this.timer = setInterval(() => {
      void this.triggerScheduledTest();
    }, intervalMs);

    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async triggerScheduledTest(): Promise<void> {
    if (this.service.isRunning) return;

    try {
      await this.service.runTest({
        provider: this.config.defaultProvider,
        triggeredBy: 'scheduled'
      });
    } catch {
      // Background scheduled run failed or conflict; ignore error to keep process alive
    }
  }
}
