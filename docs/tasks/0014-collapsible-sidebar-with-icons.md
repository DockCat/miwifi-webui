# Task 0014 — Collapsible Sidebar with UniFi-Style Icons

Status: `DONE`

Task ID: `0014`

Related plan: `docs/plans/0001-product-foundation.md` (Operational UI & Observability enhancement)

## Objective

Enhance the application's primary navigation with UniFi-inspired vector icons for every navigation tab, explicitly ensure the first tab is labeled "儀表盤" (Dashboard) rather than "網路", and provide a collapsible sidebar rail that shrinks to icon-only mode with smooth transitions and persistent state.

## Scope

In:
- Dedicated navigation component `Sidebar.tsx` in `apps/web/src/components/Sidebar.tsx`.
- Inline SVG icons matching UniFi's visual language:
  - Dashboard (`dashboard`): Speedometer / Layout dial icon (first tab, labeled "儀表盤" / "Dashboard").
  - Devices (`devices`): Connected client devices icon.
  - Network (`network`): Network topology / node branching icon.
  - Events (`events`): System event logs icon.
  - Investigations (`investigations`): Security inspection shield icon.
  - Settings (`settings`): Configuration gear icon.
- Collapsible sidebar mode:
  - Width shrinks from 220px to 68px in collapsed state with smooth cubic-bezier CSS transition.
  - In collapsed state, text labels are hidden and only icons are displayed centered.
  - Native `title` tooltips and `aria-label` for full accessibility.
  - Brand header condenses to a compact logo/monogram badge (`MW`) in collapsed mode.
  - Footer (language switcher & logout) condenses to compact icon mode with tooltips.
- Collapse toggle button (`«` / `»`) at the bottom of the sidebar with keyboard accessibility (`aria-expanded`).
- Persistent user preference in `localStorage` under `miwifi-webui.sidebar-collapsed`.
- Internationalization strings in `en` and `zh-CN` for sidebar collapse/expand actions.
- TDD unit tests covering the confirmed seams:
  - Seam 1: Sidebar rendering with icons, correct tab order, first tab verified as Dashboard ("儀表盤").
  - Seam 2: Collapsed rendering state (icon-only, compact brand, tooltips, CSS classes, `aria-expanded`).
  - Seam 3: Toggle action and `localStorage` persistence roundtrip.

Out of:
- External heavy icon font libraries or third-party menu frameworks.
- Backend storage for client-side navigation UI preferences.

## Acceptance criteria

- Every sidebar tab has a distinct SVG icon matching its operational domain.
- The first tab in the sidebar is "儀表盤" (zh-CN) / "Dashboard" (en), NOT "網路".
- Users can click the collapse button to toggle the sidebar into a narrow icon-only rail (and vice versa).
- When collapsed, only icons are visible; labels are hidden. Hovering displays tooltips.
- Collapsed preference is persisted in `localStorage` and restored on page reload.
- Clean production build with zero typecheck or lint errors.
- Default test suite and new sidebar TDD tests pass completely.

## Completion record

Status: `DONE` — completed 2026-09-18.

### Verification
- `pnpm --filter @miwifi-webui/web test`: 63 tests pass (including 8 new TDD Seam tests for Sidebar rendering, first tab naming, SVG icons, collapsed mode, accessibility, and localStorage persistence).
- `pnpm --filter @miwifi-webui/router-core test`: 59 tests pass.
- `pnpm -r typecheck`: 0 errors across all 4 packages (`contracts`, `router-core`, `api`, `web`).
- `pnpm -r build`: Clean production build (CSS: 31.40 kB, JS: 305.92 kB).
