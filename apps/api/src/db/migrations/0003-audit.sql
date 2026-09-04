-- Append-only audit events (Task 0002).
-- Metadata is allowlisted by the application; secrets (passwords, stok,
-- master key, API keys) must never appear here.

CREATE TABLE audit_event (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL DEFAULT 'user',
  actor_id uuid,
  action text NOT NULL,
  target_type text,
  target_id text,
  router_id uuid,
  outcome text NOT NULL,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_event_occurred_idx ON audit_event(occurred_at DESC);
CREATE INDEX audit_event_action_idx ON audit_event(action);
