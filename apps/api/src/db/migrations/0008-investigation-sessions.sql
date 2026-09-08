-- Investigation sessions (Task 0011): multi-turn conversations grouped by
-- session; the Investigations UI shows past sessions in a left rail.
-- Deleting a session cascades its investigations + evidence. The
-- investigation.session_id column stays nullable — pre-migration rows keep
-- working and retention still purges them by investigation.created_at.

CREATE TABLE investigation_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id uuid NOT NULL REFERENCES router(id) ON DELETE CASCADE,
  started_by uuid REFERENCES app_user(id),
  -- First question (truncated) names the session.
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX investigation_session_activity_idx
  ON investigation_session(last_activity_at DESC);

ALTER TABLE investigation
  ADD COLUMN session_id uuid REFERENCES investigation_session(id) ON DELETE CASCADE;

CREATE INDEX investigation_session_turn_idx ON investigation(session_id);
