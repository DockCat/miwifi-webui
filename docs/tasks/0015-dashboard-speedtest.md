# Task 0015 — Dashboard Speedtest Feature

Status: `DONE`

Task ID: `0015`

Related plan: `docs/plans/0001-product-foundation.md`

## Objective

Add an on-demand and scheduled Internet speed testing feature to the UniFi-style dashboard with multiple selectable providers (`Auto` [Router first, fallback to Cloudflare], `Cloudflare CDN`, and `Fast.com`), configurable periodic execution via environment variables (default 30 minutes), PostgreSQL persistence and retention, real-time SSE updates, and AI investigation tool support.

## Scope

In:
- Database migration `0010-speedtest.sql` creating `speedtest_results` table with indices.
- Contracts DTOs in `packages/contracts` for speedtest request, response, provider, and source types.
- Router adapter operation `bandwidthTest` (`/api/misystem/bandwidth_test`) with `DISRUPTIVE` effect classification.
- Speedtest providers in `apps/api/src/speedtest/providers/`:
  - `CloudflareSpeedtestProvider`: Pure TS HTTP/CDN latency, download, and upload measurement.
  - `FastSpeedtestProvider`: Netflix Fast.com CDN measurement.
  - `RouterSpeedtestRunner`: Router-side bandwidth test with automatic fallback to Cloudflare on failure/unsupported.
- Speedtest service with single-flight concurrency lock (`409 Conflict` on overlap), persistence, and SSE event broadcast via `EventBridge`.
- Configurable scheduler running every `SPEEDTEST_INTERVAL_MINUTES` (default: 30 minutes; 0 = disabled) and retention cleanup (`RETENTION_SPEEDTEST_DAYS`).
- API routes:
  - `POST /api/speedtest/run` (with optional `{ provider }`)
  - `GET /api/speedtest/latest`
  - `GET /api/speedtest/history`
- AI investigation integration:
  - Read-only tool `speedtest_history` in `apps/api/src/ai/tools.ts`.
  - System prompt and data catalog updates in `apps/api/src/ai/provider.ts`.
- Frontend dashboard component `SpeedtestBlock.tsx` integrated with `DEFAULT_LAYOUT`:
  - Download rate (Mbps), upload rate (Mbps), ping (ms), jitter (ms).
  - Provider selector dropdown (`Auto`, `Cloudflare`, `Fast.com`) with `localStorage` persistence.
  - "Run Speedtest" trigger button with interactive progress state.
  - Live SSE listener for real-time reactivity.
  - Full i18n support in `zh-CN` and `en`.
- Comprehensive TDD unit and integration tests across all defined seams.

Out of:
- Binary CLI wrappers requiring Ookla commercial licensing or heavy OS-level dependencies.
- Autonomous AI network mutation (AI investigation remains strictly read-only).

## Acceptance Criteria

- Manual speed test can be triggered from the dashboard and updates within seconds.
- Users can switch providers directly in the UI, and the choice persists across reloads.
- Router-first fallback operates seamlessly: if the router does not support the API, it falls back to backend test and records `source: 'backend'`.
- Periodic tests execute on schedule when `SPEEDTEST_INTERVAL_MINUTES > 0` and can be disabled by setting to `0`.
- Concurrent speed tests are rejected with `409 Conflict`.
- Results are persisted to PostgreSQL and cleaned up by retention policy.
- SSE stream broadcasts test results to the frontend without requiring page refresh.
- AI assistant can answer queries about speedtest history using `speedtest_history`.
- Full test suite, linting, and typecheck pass without regressions.

## Completion Record

Status: `DONE` — completed 2026-09-18.

### Verification
- `pnpm --filter @miwifi-webui/router-core test`: 59/59 tests pass.
- `pnpm --filter @miwifi-webui/api exec tsx --test test/speedtest*.test.ts test/ai.test.ts test/config.test.ts test/observability-wiring.test.ts test/envelope.test.ts`: 79/79 tests pass across Seams 1, 2, 3, 4.
- `pnpm --filter @miwifi-webui/web test`: 68/68 tests pass across Seam 5 (SpeedtestBlock rendering, Mbps formatting, live SSE, zh-CN/en i18n, and DEFAULT_LAYOUT).
- `pnpm -r typecheck`: 0 errors across all 4 packages (`contracts`, `router-core`, `api`, `web`).
- `pnpm -r build`: Clean production build for both `api` and `web`.
