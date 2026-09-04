-- Observability tables (Task 0004).
-- Telemetry snapshots, devices, and event-based presence history.
-- These three categories stay logically distinct (plan section 20).

CREATE TABLE device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  router_id uuid NOT NULL REFERENCES router(id) ON DELETE CASCADE,
  -- MAC is an observation attribute, not the human identity (randomized
  -- MACs exist); uniqueness is per-router, nullable for MAC-less rows.
  mac text,
  name text,
  ip text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  online boolean NOT NULL DEFAULT false,
  internet_access boolean NOT NULL DEFAULT true,
  UNIQUE (router_id, mac)
);

CREATE INDEX device_router_idx ON device(router_id);

-- Event-based presence history: one row per transition, never per refresh.
CREATE TABLE device_presence_event (
  id bigserial PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  router_id uuid NOT NULL REFERENCES router(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('FIRST_SEEN', 'ONLINE', 'OFFLINE')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX presence_device_time_idx ON device_presence_event(device_id, occurred_at DESC);
CREATE INDEX presence_router_time_idx ON device_presence_event(router_id, occurred_at DESC);

-- Periodic operational samples: written only by the scheduler.
CREATE TABLE telemetry_snapshot (
  id bigserial PRIMARY KEY,
  router_id uuid NOT NULL REFERENCES router(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);

CREATE INDEX telemetry_router_time_idx ON telemetry_snapshot(router_id, captured_at DESC);
