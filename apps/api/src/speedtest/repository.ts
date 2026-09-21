import type pg from 'pg';
import type {
  SpeedtestProviderType,
  SpeedtestResultDTO,
  SpeedtestSourceType,
  SpeedtestStatusType
} from '@miwifi-webui/contracts';

interface SpeedtestRow {
  id: string;
  router_id: string | null;
  download_bps: string | number;
  upload_bps: string | number;
  ping_ms: string | number;
  jitter_ms: string | number;
  provider: string;
  source: string;
  triggered_by: string;
  status: string;
  error_message: string | null;
  created_at: Date;
}

function mapRowToDTO(row: SpeedtestRow): SpeedtestResultDTO {
  return {
    id: row.id,
    routerId: row.router_id,
    downloadBps: Number(row.download_bps),
    uploadBps: Number(row.upload_bps),
    pingMs: Number(row.ping_ms),
    jitterMs: Number(row.jitter_ms),
    provider: row.provider as SpeedtestProviderType,
    source: row.source as SpeedtestSourceType,
    triggeredBy: row.triggered_by as 'manual' | 'scheduled',
    status: row.status as SpeedtestStatusType,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString()
  };
}

export class SpeedtestRepository {
  constructor(private readonly pool: pg.Pool) {}

  async insertResult(
    data: Omit<SpeedtestResultDTO, 'id' | 'createdAt'>
  ): Promise<SpeedtestResultDTO> {
    const query = `
      INSERT INTO speedtest_result (
        router_id,
        download_bps,
        upload_bps,
        ping_ms,
        jitter_ms,
        provider,
        source,
        triggered_by,
        status,
        error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;
    const values = [
      data.routerId ?? null,
      data.downloadBps,
      data.uploadBps,
      data.pingMs,
      data.jitterMs,
      data.provider,
      data.source,
      data.triggeredBy,
      data.status,
      data.errorMessage ?? null
    ];
    const { rows } = await this.pool.query<SpeedtestRow>(query, values);
    const first = rows[0];
    if (!first) {
      throw new Error('Failed to insert speedtest result');
    }
    return mapRowToDTO(first);
  }

  async getLatest(routerId?: string): Promise<SpeedtestResultDTO | null> {
    let query = `
      SELECT * FROM speedtest_result
      WHERE status = 'completed'
    `;
    const values: unknown[] = [];
    if (routerId) {
      values.push(routerId);
      query += ` AND router_id = $1`;
    }
    query += ` ORDER BY created_at DESC LIMIT 1;`;

    const { rows } = await this.pool.query<SpeedtestRow>(query, values);
    const first = rows[0];
    return first ? mapRowToDTO(first) : null;
  }

  async getHistory(
    limit = 10,
    routerId?: string,
    since?: Date
  ): Promise<SpeedtestResultDTO[]> {
    let query = `
      SELECT * FROM speedtest_result
      WHERE 1 = 1
    `;
    const values: unknown[] = [];
    let idx = 1;

    if (routerId) {
      query += ` AND router_id = $${idx++}`;
      values.push(routerId);
    }
    if (since) {
      query += ` AND created_at >= $${idx++}`;
      values.push(since);
    }

    query += ` ORDER BY created_at DESC LIMIT $${idx++};`;
    values.push(Math.min(Math.max(1, limit), 100));

    const { rows } = await this.pool.query<SpeedtestRow>(query, values);
    return rows.map(mapRowToDTO);
  }

  async purgeOlderThan(days: number): Promise<number> {
    const query = `
      DELETE FROM speedtest_result
      WHERE created_at < NOW() - INTERVAL '1 day' * $1::int;
    `;
    const result = await this.pool.query(query, [Math.floor(days)]);
    return result.rowCount ?? 0;
  }
}
