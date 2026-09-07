# Task 0010 — Customizable Dashboard Grid & Adaptive Layout

Status: `DONE`

Task ID: `0010`

Related plan: `docs/plans/0001-product-foundation.md` (Operational UI & Observability enhancement)

## Objective

Empower users to customize the UniFi operational dashboard by freely adjusting the position and dimensions (width and height) of each dashboard block, while ensuring that all internal contents (tables, charts, sub-blocks) adaptively reflow and rescale to fit the user-configured dimensions cleanly.

## Scope

In:
- 12-column responsive grid layout system (`DashboardGrid`) built with native React 19 and PointerEvents (zero external dependencies).
- Drag-and-drop repositioning with snap-to-grid alignment, boundary checking, and visual ghost preview.
- Dynamic resizing (width and height) via corner/edge resize handles with minimum constraint protections.
- Edit mode toggle ("Customize Layout" / "Done") preventing accidental movements during regular dashboard interactions.
- "Reset to Default Layout" button to restore the pristine UniFi layout anytime.
- `localStorage` persistence keyed per router ID.
- Adaptive internal content reflow:
  - `Traffic Overview`: Container queries for side-by-side or stacked donut/table layout; responsive table column collapsing on narrow widths; scrollable rows when height constrained.
  - `UniFiAreaChart`: Responsive height via `ResizeObserver` / SVG dynamic coordinate calculation, adaptive X-axis ticks.
  - `Gateway Card`: Automatic two-column reflow (art/info on left, gauges/load on right) when card width is expanded.
  - `WiFi Clients`: Elastic bar gauge track height.
  - `Most Active Clients`: Responsive card grid reflow.
- Full i18n support in `zh-CN` and `en`.
- Unit and regression test suite verifying grid math, persistence, bounds, and adaptive rendering.

Out of:
- Heavy third-party grid or dragging libraries incompatible with React 19.
- Backend database persistence for UI layout (localStorage is sufficient and immediate for client preferences).

## Acceptance criteria

- Users can toggle "Customize Layout" to drag blocks to new positions and resize their width and height.
- Content inside each block adaptively adjusts: tables fit and collapse secondary columns on narrow widths; charts scale height smoothly without overflow or distortion; Gateway card reflows to dual-column when wide.
- Layout changes are persisted in `localStorage` and restored on page reload.
- "Reset Layout" reverts all blocks to the default layout.
- Clean production build with zero typecheck or lint errors.
- Default test suite and new dashboard layout tests pass completely.

## Completion record

Status: `DONE` — completed 2026-09-07.

### Verification
- `pnpm --filter @miwifi-webui/web test`: 52 tests pass (including 11 layout engine, RGL coordinate math, vertical compaction, bounds, and adaptive grid tests).
- `pnpm --filter @miwifi-webui/router-core test`: 56 tests pass.
- `pnpm -r typecheck`: 0 errors across all 4 packages (`contracts`, `router-core`, `api`, `web`).
- `pnpm lint`: 0 errors, 0 warnings.
- `pnpm -r build`: Clean production build (CSS: 26.26 kB, JS: 267.09 kB).
- Browser validation via `ego-browser`:
  - Verified widescreen 100% width reflow (1700px content width, 1636px grid width across all 12 columns, zero empty right-side dead space).
  - Verified native RGL-style dragging with real-time `translate3d` tracking, live dashed ghost placeholder snapping, and dynamic collision push/compaction.
  - Verified multi-handle resizing (`se`, `e`, `s`) across all 7 dashboard cards.
  - Verified persistent storage in `localStorage` and instant restoration via `↺ 恢復預設佈局` (Reset Layout).
