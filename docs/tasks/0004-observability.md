# Task 0004 — Observability: Polling, Inventory, Telemetry, Presence, SSE

Status: `DONE`

Task ID: `0004`

Related plan: `docs/plans/0001-product-foundation.md` (Phase 4)
Related ADRs: 0001, 0002

## Objective

Implement the background collection loop and persistence for the three
distinct historical categories — telemetry snapshots, device presence
events (event-based, not row-per-refresh), audit events — plus live SSE
updates to the UI. Polling cadence per the plan: current state ~15s,
device inventory ~30s, persisted telemetry ~60s. UI refreshes must never
create extra telemetry rows.

## Scope

In: device normalization (synthetic device_id, MAC as attribute), device +
telemetry + presence migrations (0005), polling scheduler inside the API
process, SSE endpoint (/api/events) with reconnect support, read endpoints
for dashboard/device history.

Out of: frontend UI views (Task 0005), block/unblock (0006), AI (0007).

## Acceptance criteria

* Polling runs on fixed cadence independent of UI requests.
* Telemetry rows only from the scheduler, never from GET endpoints.
* Presence transitions recorded as events (FIRST_SEEN/ONLINE/OFFLINE),
  including reconciliation after API restart.
* SSE endpoint streams live updates with Last-Event-ID resumption.
* Unit tests for presence transition logic + device normalization;
  integration tests for telemetry cadence (no rows from reads) and SSE.
* All quality gates pass.

## Completion record

Status: `DONE` — completed 2026-09-05.

### Implementation summary

* Migration 0005: `device` (synthetic id; MAC an attribute, UNIQUE per
  router), `device_presence_event` (event-based, CHECK on kind), and
  `telemetry_snapshot` (scheduler-written samples). Three categories stay
  distinct tables.
* Domain (packages/router-core):
  - Device + router-status normalization (defensive; unknown fields are
    undefined; string/number/boolean online variants handled).
  - Presence transition logic: FIRST_SEEN / ONLINE / OFFLINE via pure
    `reconcilePresence()`; missing-from-inventory devices go OFFLINE
    (restart-safe reconciliation).
* apps/api:
  - `PollingScheduler` in-process (ADR 0004): status ~15 s (in-memory +
    SSE only), inventory ~30 s (presence reconciliation), persisted
    telemetry ~60 s — timers unref'd; UI reads never write.
  - `EventBridge`: bounded 200-event ring, listener fanout, Last-Event-ID
    replay; events carry no secrets by construction.
  - Routes: live status, device inventory, presence history, telemetry
    history, SSE `/api/events` (reconnect replay included).
* Scheduler requires APP_MASTER_KEY to open sealed credentials; runs only
  when configured (main.ts warns and serves otherwise).

### Verification

* 11 new domain tests (normalization, transitions, reconciliation, keys).
* Integration tests: telemetry row count unchanged across GETs (the core
  acceptance), presence event ordering, SSE ring replay/subscribe/bounds,
  inventory endpoint 401 + no-leak sentinel checks.
* Gates: typecheck 0, lint 0, 70 tests pass, build OK; migration 0005 applied.

### Follow-up work

Task 0005 — Operational UI (dashboard, devices, network health, events,
router compatibility views).
