/**
 * Investigation persistence (Task 0007; sessions in Task 0011).
 *
 * A session groups multi-turn investigations; its alias legends can be
 * merged to keep device_01 meaning the same device across turns. Turns
 * without a session (pre-0011 rows) remain first-class.
 */
import type pg from 'pg';
import type { ChatMessage, EvidenceLink } from './provider.js';

export interface InvestigationRow {
  readonly id: string;
  readonly startedBy: string | null;
  readonly sessionId: string | null;
  readonly provider: string;
  readonly model: string | null;
  readonly status: 'running' | 'completed' | 'failed';
  readonly question: string;
  readonly finding: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  /** alias -> original mapping used when egress was pseudonymized. */
  readonly transcript: ChatMessage[];
  readonly aliasLegend: ReadonlyArray<{ alias: string; original: string }>;
}

export interface SessionRow {
  readonly id: string;
  readonly routerId: string;
  readonly startedBy: string | null;
  readonly title: string;
  readonly status: 'open' | 'closed';
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly closedAt: Date | null;
}

/** Session list entry: the session row plus turn aggregates. */
export interface SessionSummaryRow extends SessionRow {
  readonly turnCount: number;
  readonly lastQuestion: string | null;
}

export interface EvidenceRow {
  readonly id: string;
  readonly investigationId: string;
  readonly evidenceKind: string;
  readonly evidenceId: string;
  readonly note: string | null;
  readonly createdAt: Date;
}

const SESSION_SELECT = `
  id::text AS id, router_id::text AS "routerId", started_by::text AS "startedBy",
  title, status, created_at AS "createdAt",
  last_activity_at AS "lastActivityAt", closed_at AS "closedAt"
`;

const INVESTIGATION_SELECT = `
  id::text AS id, started_by::text AS "startedBy",
  session_id::text AS "sessionId", provider, model,
  status, question, finding,
  alias_legend AS "aliasLegend", transcript,
  created_at AS "createdAt", completed_at AS "completedAt"
`;

export class InvestigationRepository {
  constructor(private readonly pool: pg.Pool) {}

  // --- Sessions ---

  async createSession(input: {
    routerId: string;
    startedBy: string | null;
    title: string;
  }): Promise<SessionRow> {
    const result = await this.pool.query<SessionRow>(
      `INSERT INTO investigation_session (router_id, started_by, title)
       VALUES ($1, $2, $3)
       RETURNING ${SESSION_SELECT}`,
      [input.routerId, input.startedBy, input.title]
    );
    return result.rows[0]!;
  }

  async rotateSession(id: string, input: { routerId: string; startedBy: string; title: string }): Promise<SessionRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const closed = await client.query("UPDATE investigation_session SET status = 'closed', closed_at = now() WHERE id = $1 AND status = 'open' RETURNING id", [id]);
      if (!closed.rowCount) throw new Error('session_closed');
      const result = await client.query<SessionRow>(
        `INSERT INTO investigation_session (router_id, started_by, title) VALUES ($1, $2, $3) RETURNING ${SESSION_SELECT}`,
        [input.routerId, input.startedBy, input.title]);
      await client.query('COMMIT');
      return result.rows[0]!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async findSession(id: string): Promise<SessionRow | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT ${SESSION_SELECT} FROM investigation_session WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async listSessions(limit = 50): Promise<SessionSummaryRow[]> {
    const result = await this.pool.query<SessionSummaryRow>(
      `SELECT s.id::text AS id, s.router_id::text AS "routerId",
              s.started_by::text AS "startedBy", s.title, s.status,
              s.created_at AS "createdAt",
              s.last_activity_at AS "lastActivityAt",
              s.closed_at AS "closedAt",
              COALESCE(turns.turn_count, 0)::int AS "turnCount",
              turns.last_question AS "lastQuestion"
       FROM investigation_session s
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS turn_count,
                (array_agg(question ORDER BY created_at DESC))[1] AS last_question
         FROM investigation i WHERE i.session_id = s.id
       ) turns ON true
       ORDER BY s.last_activity_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  /** Session turns, oldest first — conversation order for context + UI. */
  async listSessionInvestigations(sessionId: string): Promise<InvestigationRow[]> {
    const result = await this.pool.query<InvestigationRow>(
      `SELECT ${INVESTIGATION_SELECT}
       FROM investigation WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );
    return result.rows;
  }

  async touchSession(id: string): Promise<void> {
    await this.pool.query(
      'UPDATE investigation_session SET last_activity_at = now() WHERE id = $1',
      [id]
    );
  }

  /** Close a session (read-only from then on); false when not found. */
  async closeSession(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE investigation_session
       SET status = 'closed', closed_at = now()
       WHERE id = $1 AND status = 'open'`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // --- Investigations (turns) ---

  async create(
    input: {
      startedBy: string | null;
      provider: string;
      model: string | null;
      question: string;
      sessionId?: string | null;
    }
  ): Promise<InvestigationRow> {
    const result = await this.pool.query<InvestigationRow>(
      `INSERT INTO investigation (started_by, session_id, provider, model, question, status)
       VALUES ($1, $2, $3, $4, $5, 'running')
       RETURNING ${INVESTIGATION_SELECT}`,
      [input.startedBy, input.sessionId ?? null, input.provider, input.model, input.question]
    );
    return result.rows[0]!;
  }

  async complete(
    id: string,
    status: 'completed' | 'failed',
    finding: string | null,
    aliasLegend: ReadonlyArray<{ alias: string; original: string }> = [],
    transcript: readonly ChatMessage[] = []
  ): Promise<void> {
    await this.pool.query(
      `UPDATE investigation
       SET status = $2, finding = $3, alias_legend = $4::jsonb, transcript = $5::jsonb, completed_at = now()
       WHERE id = $1`,
      [id, status, finding, JSON.stringify(aliasLegend), JSON.stringify(transcript)]
    );
  }

  async addEvidence(
    investigationId: string,
    link: EvidenceLink
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO investigation_evidence (investigation_id, evidence_kind, evidence_id, note)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [investigationId, link.evidenceKind, link.evidenceId, link.note ?? null]
    );
  }

  async list(limit = 50): Promise<InvestigationRow[]> {
    const result = await this.pool.query<InvestigationRow>(
      `SELECT ${INVESTIGATION_SELECT}
       FROM investigation ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async find(id: string): Promise<InvestigationRow | null> {
    const result = await this.pool.query<InvestigationRow>(
      `SELECT ${INVESTIGATION_SELECT} FROM investigation WHERE id = $1`,
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
