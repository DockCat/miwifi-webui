-- Speedtest results table (Task 0015).
CREATE TABLE IF NOT EXISTS speedtest_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id uuid REFERENCES router(id) ON DELETE CASCADE,
  download_bps bigint NOT NULL,
  upload_bps bigint NOT NULL,
  ping_ms numeric(8, 2) NOT NULL,
  jitter_ms numeric(8, 2) NOT NULL DEFAULT 0,
  provider text NOT NULL,
  source text NOT NULL CHECK (source IN ('router', 'backend')),
  triggered_by text NOT NULL CHECK (triggered_by IN ('manual', 'scheduled')),
  status text NOT NULL CHECK (status IN ('completed', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS speedtest_created_at_idx ON speedtest_result(created_at DESC);
CREATE INDEX IF NOT EXISTS speedtest_router_created_idx ON speedtest_result(router_id, created_at DESC);
