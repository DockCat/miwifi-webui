# Task 0003 — MiWifiAdapter / Compatibility-Probe Foundation

Status: `DONE`

Task ID: `0003`

Related plan: `docs/plans/0001-product-foundation.md` (Phase 3)
Related ADRs: ADR 0001 (backend-mediated router access), 0002 (PostgreSQL)

## Objective

Build the typed router abstraction behind which all Xiaomi/MiWiFi
HTTP behavior lives: a transport interface (real HTTP + fixture/mock for
tests), MiWiFi login + stok session lifecycle (backend-only), the safe
read-only compatibility probe, capability profile normalization, and
router persistence (router + encrypted credential + capability rows).
Routers are onboarded by host/address validated against the local/private
network policy — never arbitrary URLs.

## Scope

In: packages/router-core adapter types + probe + normalization; apps/api
router repository (migrations 0004), onboarding route, stok lifecycle with
encrypted credential renewal, adapter contract tests via fixtures.

Out of: device inventory/polling (Task 0004), block/unblock (Task 0006),
AI (Task 0007).

## Security requirements

* Router password sealed with the envelope before persistence; plaintext
  exists only in memory during login/renewal.
* stok never returned to the frontend, never logged, never audited.
* All router operations declare an explicit effect class.
* Onboarding accepts host/address only (validateRouterTarget).
* stok must not be persisted as ordinary data (ephemeral memory cache).

## Acceptance criteria

* Fixture-based contract tests cover: successful login, auth failure,
  token expiry + renewal via sealed credential, malformed responses,
  unknown model, partial support, offline router, probe of each capability.
* Onboarding route validates target, probes safely, persists router with
  capability profile; responses expose no secrets (sentinel tests).
* All quality gates pass.

## Completion record

Status: `DONE` — completed 2026-09-05.

### Implementation summary

* `packages/router-core`:
  - `RouterTransport` interface + `RouterTransportError` (offline / timeout /
    http-status / malformed / aborted classification).
  - Operation catalog (`operations.ts`): every MiWiFi request with path
    template, method, **explicit effect class**, stok requirement, probe
    flag — effect never inferred from HTTP method.
  - `MiWifiAdapter`: login (token + redirect-url stok forms), stok held
    ephemeral in memory only (30 min TTL, never persisted), session
    invalidation on MiWiFi code 9, transparent renewal via credentials.
  - Read-only compatibility probe: init_info -> login -> per-capability
    endpoints -> classification SUPPORTED / PARTIAL / UNKNOWN / INCOMPATIBLE.
    Unknown models proceed through probing (no model whitelist).
  - `FixtureTransport` (deterministic scripted scenarios) +
    `HttpRouterTransport` (validated host only, catalog-generated paths,
    redirects refused, timeouts via AbortSignal, offline classification).
* `apps/api`:
  - Migration 0004: `router` + `router_credential` (sealed password).
  - `RouterRepository`: upsert/list/find, credential save/load via
    envelope (APP_MASTER_KEY outside PostgreSQL).
  - Onboarding route: host validated by `validateRouterTarget` (no
    arbitrary URLs), probe, persist, seal credential, audit; summary DTOs
    contain no secrets (defense-in-depth sentinel check before responding).
* `packages/contracts`: `RouterSummary` browser-safe DTO.

### Verification

* 12 adapter contract tests (fixture transport): successful login, auth
  failure, offline router, unknown-model-accepted, partial support,
  INCOMPATIBLE cases, token expiry (code 9) + renewal, malformed bodies,
  password never in probe output.
* Full workspace gates: typecheck 0, lint 0, 52 tests pass, build OK.
* Migration 0004 applied; onboarding route typechecks against the sealed
  credential path (live-router behavior deferred to opt-in testing per
  plan section 42).

### Follow-up work

Task 0004 — Observability: router state polling, device inventory,
telemetry persistence, presence events, SSE updates.
