# Task 0012 — Investigation context, evidence and privacy

Status: `DONE`

## Objective and scope

Review and repair the existing uncommitted Task 0011 implementation: retain
complete session exchanges including tool results, automatically start a fresh
session before the history budget is exceeded, preserve manual creation/history,
and answer time-window device traffic questions from persisted telemetry.

## Requirements

* Replay all completed exchanges, never silently drop oldest turns. Store sanitized
  tool transcripts. Rotate at 48,000 UTF-8 bytes of prior conversation plus the new
  question; bound each provider request to 128,000 bytes including schemas.
  These are conservative application byte budgets, not claimed model token counts.
* Use fixed router-scoped SQL to rank observed counter deltas. The traffic intent
  forces the `device_traffic_usage` tool on the first provider request, including
  follow-up peak-period questions. Return the largest observed consecutive delta
  as `peakInterval` with start/end times and sample evidence IDs. Report sample
  window, resets and gaps; never represent sampled/partial data as an exact 24-hour total.
  The scheduler supplements health samples with the read-only device inventory so
  per-device counters are actually persisted when firmware omits them from status.
* External MAC/IP/names always pseudonymized. Task 0011's names opt-out conflicts
  with AGENTS.md and is removed; no architectural boundary is relaxed.
* Secrets excluded from tool output, logs and errors. Only validated successful
  evidence lookups and validated telemetry samples become evidence links; safe
  context notes make each reference inspectable without exposing raw router data.
  Tools remain read-only.

## Out of scope

Router mutation, arbitrary SQL, new providers/dependencies, deployment, provider
spend, recovering telemetry never collected, guarantees of LLM correctness.

## Acceptance and verification

Regression checks for complete replay and rotation, names/secrets in provider
requests, safe failures, counter resets/gaps/ranking and isolation. Run typecheck,
lint, unit/integration tests and build; record unavailable checks honestly.

## Completion record

Status: `DONE` — completed 2026-09-08.

Verification: `pnpm typecheck` passed; `pnpm lint` passed; `pnpm test` passed
(220 tests: router-core 57, web 55, API 108); `pnpm build` passed. The API
integration suite applied migrations through 0009 against a throwaway
PostgreSQL database and used a mocked provider; no live router or paid
provider was contacted.
