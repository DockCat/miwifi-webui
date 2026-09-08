# Task 0011 — Investigation Sessions, Locale-aware AI, Extended Read Tools

Status: `DONE`

Historical record: context truncation and the names opt-out below are superseded
by Task 0012. The names exception conflicted with repository security rules and
is removed; it is not an accepted architecture decision.

Task ID: `0011`

Related plan: `docs/plans/0001-product-foundation.md` (Phase 7, AI investigation)

## Objective

Upgrade the AI investigation layer from one-shot Q&A to session-based
multi-turn conversations with locale-aware responses and a richer read-only
tool registry:

* sessions group turns; the Investigations UI gains a left rail of past
  sessions with lazy creation, manual close (read-only afterwards), and a
  "New session" button;
* same-session turns replay every completed exchange until the current
  48,000-byte application context budget and seed the alias map from prior legends so
  `device_01` keeps meaning the same device across turns;
* findings follow the UI language (`zh-CN` → Simplified Chinese, `en` →
  English) via a locale field on the create endpoint and a locale-directed
  system prompt; the iterations-exhausted nudge is localized too;
* the system prompt carries a data-views catalog (what the dashboard/devices/
  events pages show and which tool reads each) so the agent can point users
  at the right view;
* new read-only tools: `telemetry_timeseries` (1d/1w/1m bucketed WAN/CPU/
  memory history, same SQL as the dashboard chart) and `dashboard_summary`
  (one-shot overview: latest status, device counts by connection type,
  top devices by live rate); `device_state` gains live rates/totals/
  connection type from the scheduler's in-memory map; `presence_history`
  joins device names (pseudonymized per the privacy policy);
* external providers receive aliases for MACs, IPs and device names; the
  removed `AI_EXTERNAL_SEND_NAMES` setting is ignored.

## Security notes

* Session routes sit behind `requireAuth`; closing a session is audited
  (`ai.session_closed`). Turn audit metadata carries `sessionId` + `locale`
  (both non-secret, pass the audit allowlist).
* Closed sessions reject new turns with 409 `session_closed` **before** the
  provider is called — a closed conversation cannot spend provider quota.
* Tool registry stays read-only by construction (8 tools, no write path);
  MAC/IP are never emitted raw by any tool regardless of mode.
* The names opt-out was removed because it conflicted with the repository
  security invariant. External egress aliases MACs, IPs and names.
* Retention: sessions purge with their turns (cascade) by
  `last_activity_at` under the existing `RETENTION_INVESTIGATION_DAYS`
  window; legacy null-session investigations keep the old `created_at` purge.

## Acceptance criteria

* Migration 0008 creates `investigation_session` + `investigation.session_id`
  (nullable for legacy rows); deleting a session cascades turns + evidence.
* POST /api/investigations accepts `sessionId?` + `locale?`; creates a session
  lazily (title = first question ≤60 chars); rejects closed sessions (409),
  unknown sessions (404), router mismatch (400).
* GET /api/investigations/sessions lists by last activity with turn counts;
  GET /api/investigations/sessions/:id returns turns oldest-first;
  POST .../close is idempotent-conflict (409 on re-close).
* Locale directive reaches the system prompt and the finalize nudge.
* History replay includes all completed exchanges until the 48,000-byte
  budget triggers a new session; failed/running turns are skipped.
* Alias seeding restores the same alias for the same identifier across turns
  and continues the counter without collision.
* All 8 tools reject out-of-range inputs; the new tools validate their enums.
* Frontend: two-pane Investigations view (session rail + chat), closed
  sessions read-only, locale passed with each turn.
* All quality gates pass.

## Verification

* `apps/api/test/ai.test.ts`: registry = 8 tools; names are always aliased;
  `seedFromLegend` round-trip, idempotency, malformed-entry
  tolerance; locale prompt; history bounds; provider request shape.
* `apps/api/test/sessions.integration.test.ts` (new): lazy creation +
  title, second-turn context replay, close → 409 without provider call,
  locale in prompt, 404 unknown session, retention cascade.
* `apps/web/test/InvestigationsView.test.tsx`: rail chrome, i18n keys,
  turn order preservation.
* Gates: typecheck 0, lint 0, 204 tests, build OK; migration 0008 applied.

## Completion record

Status: `DONE` — completed 2026-09-07.
