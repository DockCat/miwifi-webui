-- Baseline migration: bootstrap bookkeeping table only.
--
-- No application tables yet. The _migrations table itself is created by the
-- migration runner before any file is applied; this file exists to verify
-- the migration path works end-to-end and to pin the ordering convention
-- (NNNN-description.sql). Real entities (app_user, router, ...) arrive with
-- their own tasks and are NOT prematurely defined here.
SELECT 1;
