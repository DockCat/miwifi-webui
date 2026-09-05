# Task 0009 — UniFi Dashboard & Device Usage Observability

Status: `DONE`

Task ID: `0009`

Related plan: `docs/plans/0001-product-foundation.md` (UI and Observability enhancement)

## Objective

Transform the operational dashboard into a high-density, UniFi Network OS inspired layout with native SVG charts (donut, area, bar gauge), full MiWiFi per-device bandwidth and cumulative traffic observability, timeseries telemetry bucket aggregation, and interactive device usage inspection drawer.

## Scope

In:
- Router-core normalization of device bandwidth (`downspeed`, `upspeed`), cumulative traffic (`downloadTotal`, `uploadTotal`), and connection medium (`wired`, `wifi_2g`, `wifi_5g`, `guest`).
- Shared contract definitions (`DeviceDTO`, `TimeseriesPoint`).
- Backend PostgreSQL time-bucket aggregation endpoint (`GET /api/routers/:id/telemetry/timeseries?range=1d|1w|1m`).
- Scheduler in-memory live device rate cache and enriched SSE inventory event payload.
- Native lightweight SVG charts: `<UniFiDonutChart />`, `<UniFiAreaChart />` (cubic bezier splines, gradients, crosshair tooltip), `<UniFiBarGauge />` (utilization gauges and Wi-Fi band split bars).
- Slide-over `<DeviceUsageDrawer />` for one-click device inspection (rates, total data, connection details, internet control, presence timeline).
- Rebuilt `DashboardView` with UniFi aesthetic (header pills, gateway hero card, traffic overview, client device types, Wi-Fi clients, active clients carousel, timeseries chart).
- Full i18n support in `zh-CN` and `en`.

Out of:
- Destructive router mutations.
- Deep packet inspection.
- External heavy charting libraries.

## Acceptance criteria

- All charts rendered using lightweight native SVG without external charting library bloat.
- Dashboard shows gateway card, live utilization gauges, traffic overview donut, client types donut, Wi-Fi band bars, active clients carousel, and throughput timeline area chart.
- Clicking any active device or row opens the device usage inspection drawer with real-time rate, cumulative transfer, and access controls.
- 1D/1W/1M time range filtering calculates bucketed averages over PostgreSQL `telemetry_snapshot`.
- Devices table view displays connection type, real-time speed, and total traffic.
- Full test suite passes (router-core, api, web) with zero typecheck or lint errors.

## Completion record

Status: `DONE` — completed 2026-09-05.

### Verification
- `pnpm -r typecheck`: 0 errors across all workspace packages.
- `pnpm -r test`: 118 tests pass (49 router-core, 54 api, 15 web).
- `pnpm lint`: 0 errors, 0 warnings.
- `pnpm -r build`: Clean production build (CSS: 18.4 kB, JS: 245.5 kB).
