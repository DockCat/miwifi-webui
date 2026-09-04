# Task 0005 — Operational UI

Status: `DONE`

Task ID: `0005`

Related plan: `docs/plans/0001-product-foundation.md` (Phase 5)

## Objective

Build the operational web UI on the existing API: persistent navigation
(Dashboard / Devices / Network / Events / Settings), login flow, device
inventory table, device drill-down with presence timeline, router
compatibility panel, live SSE-driven status updates. UniFi-inspired
operational principles, original implementation; status never communicated
by color alone (text + icon + badge). i18n foundation (zh-CN + en).

## Scope

In: login page + bootstrap flow, app shell with nav, dashboard (router
health, device count, recent events), devices table + detail, events view,
settings (account password change), SSE client hook, minimal i18n with
browser-locale default.

Out of: router mutations (0006), AI views (0007), production visual
polish beyond functional clarity.

## Acceptance criteria

* Login required before any operational route.
* Dashboard shows live status; SSE updates without refresh.
* Devices table: name/IP/MAC/online state (badge + text)/first/last seen.
* Presence timeline on device detail.
* All states communicated with text (not color-only).
* Frontend tests: login renders, app shell renders, device table rows
  render from fixture data, i18n switches labels.
* All quality gates pass.

## Completion record

Status: `DONE` — completed 2026-09-05.

### Implementation summary

* App shell: session gate (login required), persistent sidebar navigation
  (Dashboard / Devices / Network / Events / Settings), responsive
  collapse on small screens; original UniFi-inspired styling, no
  proprietary assets.
* Login page with first-run bootstrap detection (empty-probe pattern
  distinguishing open vs closed bootstrap); errors as text, no
  user-enumeration hints.
* Dashboard: router health stats, devices-online count, recent presence
  events — live via SSE (`useLiveEvents` with backoff reconnect +
  Last-Event-ID resume).
* Devices: dense table (name/IP/MAC/status/first/last seen), drill-down
  detail with presence timeline; status badges use text + glyph + color
  (never color alone).
* Network view: router identity, firmware, compatibility badge,
  capabilities. Events view: presence history list.
* Settings: router onboarding form (host/username/password), password
  change (revokes sessions), sign-out.
* i18n foundation: zh-CN + en catalogs, browser-locale detection; all
  labels through `t()`.
* Hash router (no dependency); API client typed against
  `@miwifi-webui/contracts` DTO shapes.

### Verification

* SSR-render tests: loading gate, login flow markup, devices table from
  fixture data (online/offline as text), empty states, no-leak checks
  (no stok / cgi-bin / router IP in markup), i18n catalog behavior.
* Live verification: API + Vite up, page served, /api proxy healthy.
* Gates: typecheck 0, lint 0, 76 tests pass, production build OK.

### Follow-up work

Task 0006 — Limited administration: device Internet block/unblock with
confirmation, audit, read-back verification.
