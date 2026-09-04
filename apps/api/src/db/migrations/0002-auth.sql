-- Authentication tables (Task 0002).
-- Single administrator for v1, but a normal user/session architecture so
-- multi-user support later does not require replacing the auth boundary.

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  password_changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  -- sha256 of the opaque session token; the raw token exists only in the
  -- HttpOnly cookie.
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_from uuid
);

CREATE INDEX app_session_user_idx ON app_session(user_id);
CREATE INDEX app_session_idle_idx ON app_session(idle_expires_at);
