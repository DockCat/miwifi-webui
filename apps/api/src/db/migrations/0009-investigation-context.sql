-- Sanitized conversation and tool messages, subject to investigation retention.
ALTER TABLE investigation ADD COLUMN transcript jsonb NOT NULL DEFAULT '[]'::jsonb;
