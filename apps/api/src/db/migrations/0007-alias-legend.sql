-- Alias legend for pseudonymized investigations (AI privacy pass, 2026-09).
-- External providers receive device_01-style aliases; this column stores the
-- alias -> original mapping locally so findings stay readable to the
-- administrator. The legend NEVER leaves the application (it is not sent to
-- the provider) and is purged with the investigation by existing retention.

ALTER TABLE investigation
  ADD COLUMN alias_legend jsonb NOT NULL DEFAULT '[]'::jsonb;
