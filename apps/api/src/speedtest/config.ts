import process from 'node:process';
import type { SpeedtestProviderType } from '@miwifi-webui/contracts';

export interface SpeedtestConfig {
  readonly enabled: boolean;
  readonly intervalMinutes: number;
  readonly defaultProvider: SpeedtestProviderType;
  readonly downloadBytes: number;
  readonly uploadBytes: number;
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

  const rawDlBytes = process.env.SPEEDTEST_DOWNLOAD_BYTES;
  let downloadBytes = 50_000_000; // 50MB default
  if (rawDlBytes !== undefined && rawDlBytes.trim() !== '') {
    const parsed = Number.parseInt(rawDlBytes.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 1_000_000) {
      downloadBytes = parsed;
    }
  }

  const rawUlBytes = process.env.SPEEDTEST_UPLOAD_BYTES;
  let uploadBytes = 20_000_000; // 20MB default
  if (rawUlBytes !== undefined && rawUlBytes.trim() !== '') {
    const parsed = Number.parseInt(rawUlBytes.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 1_000_000) {
      uploadBytes = parsed;
    }
  }

  return { enabled, intervalMinutes, defaultProvider, downloadBytes, uploadBytes };
}
