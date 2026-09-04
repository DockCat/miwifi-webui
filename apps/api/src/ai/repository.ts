/**
 * Investigation persistence (Task 0007).
 */
import type pg from 'pg';
import type { EvidenceLink } from './provider.js';

export interface InvestigationRow {
  readonly id: string;
  readonly startedBy: string | null;
  readonly provider: string;
  readonly model: string | null;
  readonly status: 'running' | 'completed' | 'failed';
  readonly question: string;
  readonly finding: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export interface EvidenceRow {
  readonly id: string;
  readonly investigationId: string;
  readonly evidenceKind: string;
  readonly evidenceId: string;
  readonly note: string | null;
  readonly createdAt: Date;
}

export class InvestigationRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(
    input: { startedBy: string | null; provider: string; model: string | null; question: string }
  ): Promise<InvestigationRow> {
    const result = await this.pool.query<InvestigationRow>(
      `INSERT INTO investigation (started_by, provider, model, question, status)
       VALUES ($1, $2, $3, $4, 'running')
       RETURNING id::text AS id, started_by::text AS "startedBy", provider,
                 model, status, question, finding,
                 created_at AS "createdAt", completed_at AS "completedAt"`,
      [input.startedBy, input.provider, input.model, input.question]
    );
    return result.rows[0]!;
  }

  async complete(
    id: string,
    status: 'completed' | 'failed',
    finding: string | null
  ): Promise<void> {
    await this.pool.query(
      `UPDATE investigation
       SET status = $2, finding = $3, completed_at = now()
       WHERE id = $1`,
      [id, status, finding]
    );
  }

  async addEvidence(
    investigationId: string,
    link: EvidenceLink
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO investigation_evidence (investigation_id, evidence_kind, evidence_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [investigationId, link.evidenceKind, link.evidenceId]
    );
  }

  async list(limit = 50): Promise<InvestigationRow[]> {
    const result = await this.pool.query<InvestigationRow>(
      `SELECT id::text AS id, started_by::text AS "startedBy", provider, model,
              status, question, finding,
              created_at AS "createdAt", completed_at AS "completedAt"
       FROM investigation ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async find(id: string): Promise<InvestigationRow | null> {
    const result = await this.pool.query<InvestigationRow>(
      `SELECT id::text AS id, started_by::text AS "startedBy", provider, model,
              status, question, finding,
              created_at AS "createdAt", completed_at AS "completedAt"
       FROM investigation WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async listEvidence(investigationId: string): Promise<EvidenceRow[]> {
    const result = await this.pool.query<EvidenceRow>(
      `SELECT id::text AS id, investigation_id::text AS "investigationId",
              evidence_kind AS "evidenceKind", evidence_id AS "evidenceId",
              note, created_at AS "createdAt"
       FROM investigation_evidence WHERE investigation_id = $1 ORDER BY id`,
      [investigationId]
    );
    return result.rows;
  }

  /**
   * Retention: purge investigation content older than the retention window
   * (default ~30 days, plan section 22/34). Audit records of the purge
   * itself live in audit_event and are NOT removed here.
   */
  async purgeOlderThan(
    retentionDays: number,
    now: Date = new Date()
  ): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM investigation WHERE created_at < $1',
      [new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)]
    );
    return result.rowCount ?? 0;
  }
}
