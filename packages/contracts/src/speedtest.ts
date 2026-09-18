/**
 * Speedtest DTOs shared between api and web.
 */

export type SpeedtestProviderType = 'auto' | 'cloudflare' | 'mlab' | 'fast';
export type SpeedtestSourceType = 'router' | 'backend';
export type SpeedtestStatusType = 'running' | 'completed' | 'failed';

export interface SpeedtestResultDTO {
  readonly id: string;
  readonly routerId?: string | null;
  readonly downloadBps: number;
  readonly uploadBps: number;
  readonly pingMs: number;
  readonly jitterMs: number;
  readonly provider: SpeedtestProviderType;
  readonly source: SpeedtestSourceType;
  readonly triggeredBy: 'manual' | 'scheduled';
  readonly status: SpeedtestStatusType;
  readonly errorMessage?: string | null;
  readonly createdAt: string;
}

export interface SpeedtestRunRequest {
  readonly provider?: SpeedtestProviderType;
}

export interface SpeedtestRunResponse {
  readonly result: SpeedtestResultDTO;
}

export interface SpeedtestLatestResponse {
  readonly latest: SpeedtestResultDTO | null;
}

export interface SpeedtestHistoryResponse {
  readonly history: SpeedtestResultDTO[];
}
