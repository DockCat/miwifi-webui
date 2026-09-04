# Task 0008 — Hardening

Status: `DONE`

Task ID: `0008`

Related plan: `docs/plans/0001-product-foundation.md` (Phase 8, section 22)

## Objective

Harden the completed feature set: configurable retention across all
historical categories, backup/restore documentation, extended router
compatibility fixtures, failure-mode tests (DB down, router mid-session
expiry), README operational documentation, and production-readiness for
the compose topology.

## Scope

In: retention repository methods + scheduler wiring (telemetry ~90d,
presence ~1y, audit ~1y, investigation ~30d); docs/backup-restore.md;
extended fixture scenarios (token expiry mid-call, malformed status,
redirect-style login); failure-mode integration tests (API with DB down
still serves /api/health, ready reports database:false); README ops
sections (env reference, retention, backup); compose profile for full
stack (api + postgres; web served as static bundle by api is acceptable
for v1 or via vite preview — documented).

Out of: new features; TLS automation; multi-router UX.

## Acceptance criteria

* Retention purge methods unit-tested with clock injection.
* Backup/restore doc covers pg_dump/pg_restore + master-key handling.
* Failure-mode: API with unreachable DB serves health (200) and ready
  (database:false, 200) — verified by test.
* README contains a complete env-var reference and retention defaults.
* All quality gates pass.

## Completion record

Status: `DONE` — completed 2026-09-05.

### Implementation summary

* Retention: policy module (env-configurable, defaults 90/365/365/30)
  with injected-clock cutoff math; per-category purge repository; daily
  scheduler pass replacing the investigation-only purge.
* **Global error handler added** — failure-mode testing exposed a real
  leak: Fastify's default 500 handler surfaced
  `connect ECONNREFUSED 127.0.0.1:59999` (DB host:port) in response
  bodies. All unhandled errors now return `{"error":"internal"}` with the
  detail logged server-side only.
* Failure-mode tests: DB-unreachable API still serves health 200, ready
  reports `database:false` without connection details, protected endpoints
  fail closed (401), bootstrap returns clean JSON errors (no stack
  traces, no connection strings, no ports).
* Extended compatibility fixtures: redirect-style stok login parsing,
  token-less login rejection, mid-session expiry with transparent
  renewal, malformed status bodies, scenario-library probe consistency.
* docs/backup-restore.md: pg_dump/pg_restore, master-key-separately
  handling, sensitivity notes, retention/backup interaction.
* README: complete environment-variable reference, retention defaults,
  operational notes (bootstrap recovery, credential sealing, AI default,
  LAN HTTPS guidance), backup link.

### Verification

* Gates: typecheck 0, lint 0, 108 tests (48 router-core incl. 4 new
  fixture tests; 52 api incl. 5 retention + 4 failure-mode), build OK.
* Retention purges verified against a throwaway DB with frozen clock
  (old rows purged, fresh kept).
* The error-handler leak was found BY the new failure-mode test —
  exactly the regression coverage the plan requires (section 43).

### Follow-up work

Suggested future tasks: automated e2e run via mock router (plan section
41), compose production image for api+web, retention configurability UI,
multi-router UX.
