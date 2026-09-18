import process from 'node:process';
import type { SpeedtestProviderType } from '@miwifi-webui/contracts';

export interface SpeedtestConfig {
  readonly enabled: boolean;
  readonly intervalMinutes: number;
  readonly defaultProvider: SpeedtestProviderType;
}

export function loadSpeedtestConfig(): SpeedtestConfig {
  const rawEnabled = process.env.SPEEDTEST_ENABLED;
  const enabled = rawEnabled === undefined || (rawEnabled !== 'false' && rawEnabled !== '0');

  const rawInterval = process.env.SPEEDTEST_INTERVAL_MINUTES;
  let intervalMinutes = 30;
  if (rawInterval !== undefined && rawInterval.trim() !== '') {
    const parsed = Number.parseInt(rawInterval.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      intervalMinutes = parsed;
    }
  }

  const rawProvider = process.env.SPEEDTEST_DEFAULT_PROVIDER?.trim().toLowerCase();
  const defaultProvider: SpeedtestProviderType =
    rawProvider === 'cloudflare' || rawProvider === 'fast' ? rawProvider : 'auto';

  return { enabled, intervalMinutes, defaultProvider };
}
