import type { SpeedtestProviderType, SpeedtestSourceType } from '@miwifi-webui/contracts';

export interface SpeedtestExecutionResult {
  readonly downloadBps: number;
  readonly uploadBps: number;
  readonly pingMs: number;
  readonly jitterMs: number;
  readonly provider: SpeedtestProviderType;
  readonly source: SpeedtestSourceType;
  readonly status: 'completed' | 'failed';
  readonly errorMessage?: string | null;
}

export interface SpeedtestProvider {
  readonly name: SpeedtestProviderType;
  run(): Promise<SpeedtestExecutionResult>;
}
