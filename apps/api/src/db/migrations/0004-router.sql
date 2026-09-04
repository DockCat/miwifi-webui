-- Router registry + capability profile (Task 0003, ADR 0001/0002).

CREATE TABLE router (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Synthetic identity: host/model are attributes, never the PK.
  host text NOT NULL,
  model text,
  hardware text,
  rom_version text,
  channel text,
  compatibility text NOT NULL DEFAULT 'UNKNOWN',
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_probed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host)
);

-- Encrypted router credential (envelope-sealed under APP_MASTER_KEY).
CREATE TABLE router_credential (
  router_id uuid PRIMARY KEY REFERENCES router(id) ON DELETE CASCADE,
  username text NOT NULL,
  sealed_password text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
