-- AI investigations + evidence (Task 0007, plan sections 32-34).
-- Investigation content is separate from long-lived audit history; default
-- retention ~30 days via an explicit purge pass.

CREATE TABLE investigation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_by uuid REFERENCES app_user(id),
  provider text NOT NULL,
  model text,
  status text NOT NULL DEFAULT 'running',
  question text NOT NULL,
  finding text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE investigation_evidence (
  id bigserial PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES investigation(id) ON DELETE CASCADE,
  -- What kind of local record backs a finding step.
  evidence_kind text NOT NULL CHECK (evidence_kind IN
    ('telemetry_snapshot', 'presence_event', 'device', 'audit_event')),
  evidence_id text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX investigation_evidence_idx ON investigation_evidence(investigation_id);
CREATE INDEX investigation_created_idx ON investigation(created_at DESC);
