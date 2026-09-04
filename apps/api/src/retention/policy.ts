/**
 * Retention policy (Task 0008, plan section 22).
 *
 * Defaults are deliberately conservative and configurable via env. The
 * purge passes are explicit scheduled application behavior — nothing is
 * deleted opportunistically.
 */
import process from 'node:process';

export interface RetentionPolicy {
  /** High-resolution telemetry, days. Default ~90. */
  readonly telemetryDays: number;
  /** Presence events, days. Default ~365 (compact, long-lived). */
  readonly presenceDays: number;
  /** Audit events, days. Default ~365 (append-only except retention). */
  readonly auditDays: number;
  /** Investigation content, days. Default ~30. */
  readonly investigationDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  telemetryDays: 90,
  presenceDays: 365,
  auditDays: 365,
  investigationDays: 30
};

function envDays(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 3650) return fallback;
  return value;
}

/** Load policy from env; malformed values fall back to defaults. */
export function loadRetentionPolicy(): RetentionPolicy {
  return {
    telemetryDays: envDays('RETENTION_TELEMETRY_DAYS', DEFAULT_RETENTION.telemetryDays),
    presenceDays: envDays('RETENTION_PRESENCE_DAYS', DEFAULT_RETENTION.presenceDays),
    auditDays: envDays('RETENTION_AUDIT_DAYS', DEFAULT_RETENTION.auditDays),
    investigationDays: envDays(
      'RETENTION_INVESTIGATION_DAYS',
      DEFAULT_RETENTION.investigationDays
    )
  };
}

export interface RetentionClock {
  now(): Date;
}

export const systemClock: RetentionClock = {
  now: () => new Date()
};

/** Cutoff timestamp for a retention window (pure, testable). */
export function retentionCutoff(
  policy: RetentionPolicy,
  key: keyof RetentionPolicy,
  clock: RetentionClock = systemClock
): Date {
  return new Date(clock.now().getTime() - policy[key] * 24 * 60 * 60 * 1000);
}

export interface PurgeResult {
  readonly category: string;
  readonly purged: number;
}
