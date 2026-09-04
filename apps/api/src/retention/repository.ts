/**
 * Retention repository: purge passes per historical category (Task 0008).
 *
 * Each purge returns the number of rows removed and is auditable via the
 * caller (the scheduler emits a retention event; app audit rows record
 * purges as explicit administrative behavior).
 */
import type pg from 'pg';
import type { RetentionPolicy } from './policy.js';
import { retentionCutoff, type PurgeResult, type RetentionClock } from './policy.js';

export class RetentionRepository {
  constructor(private readonly pool: pg.Pool) {}

  async purgeTelemetry(
    policy: RetentionPolicy,
    clock?: RetentionClock
  ): Promise<PurgeResult> {
    const cutoff = retentionCutoff(policy, 'telemetryDays', clock);
    const result = await this.pool.query(
      'DELETE FROM telemetry_snapshot WHERE captured_at < $1',
      [cutoff]
    );
    return { category: 'telemetry', purged: result.rowCount ?? 0 };
  }

  async purgePresence(
    policy: RetentionPolicy,
    clock?: RetentionClock
  ): Promise<PurgeResult> {
    const cutoff = retentionCutoff(policy, 'presenceDays', clock);
    const result = await this.pool.query(
      'DELETE FROM device_presence_event WHERE occurred_at < $1',
      [cutoff]
    );
    return { category: 'presence', purged: result.rowCount ?? 0 };
  }

  async purgeAudit(
    policy: RetentionPolicy,
    clock?: RetentionClock
  ): Promise<PurgeResult> {
    // Audit is append-only during normal operation; this purge is the
    // explicit, scheduled exception (plan section 23).
    const cutoff = retentionCutoff(policy, 'auditDays', clock);
    const result = await this.pool.query(
      'DELETE FROM audit_event WHERE occurred_at < $1',
      [cutoff]
    );
    return { category: 'audit', purged: result.rowCount ?? 0 };
  }

  async purgeInvestigations(
    policy: RetentionPolicy,
    clock?: RetentionClock
  ): Promise<PurgeResult> {
    const cutoff = retentionCutoff(policy, 'investigationDays', clock);
    const result = await this.pool.query(
      'DELETE FROM investigation WHERE created_at < $1',
      [cutoff]
    );
    return { category: 'investigation', purged: result.rowCount ?? 0 };
  }

  async purgeAll(
    policy: RetentionPolicy,
    clock?: RetentionClock
  ): Promise<readonly PurgeResult[]> {
    return [
      await this.purgeTelemetry(policy, clock),
      await this.purgePresence(policy, clock),
      await this.purgeAudit(policy, clock),
      await this.purgeInvestigations(policy, clock)
    ];
  }
}
