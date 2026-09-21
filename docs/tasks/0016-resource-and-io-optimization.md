# Task 0016 — Resource and Disk I/O Optimization

Status: `DONE`

Task ID: `0016`

Related plan: `docs/plans/0001-product-foundation.md` (Observability & Persistence performance)
Related ADR: `docs/adr/0005-telemetry-durability-and-batching.md`

## Objective

Remediate and optimize system resource consumption and disk I/O write queue saturation identified during cluster monitoring on node `omarchy` (`writeTimePercent` > 80%~140%, `writeAwaitMs` > 32~50ms). Eliminate write amplification through PostgreSQL asynchronous durability configuration, application-level change-detection (dirty checking) for device heartbeats, single-transaction batch updates, and configurable polling intervals.

## Scope

In:
- **PostgreSQL Compose Configuration**:
  - Update `compose.yaml` (and local developer overrides such as `compose-dev.yml`) to launch PostgreSQL with:
    - `-c synchronous_commit=off`
    - `-c wal_writer_delay=200ms`
- **Application Configuration**:
  - Add configurable polling intervals in `apps/api/src/config.ts` via environment variables:
    - `POLLING_STATUS_INTERVAL_MS` (default: 15,000)
    - `POLLING_INVENTORY_INTERVAL_MS` (default: 60,000)
    - `POLLING_TELEMETRY_INTERVAL_MS` (default: 60,000)
  - Document the new environment variables in `.env.example`.
  - Pass the loaded config to `PollingScheduler` in `apps/api/src/main.ts`.
- **Repository Batching & Change Detection**:
  - In `apps/api/src/observability/repository.ts`:
    - Implement `batchUpdateDeviceObservations` to update multiple device observations in a single database transaction (`BEGIN ... COMMIT`).
  - In `apps/api/src/observability/scheduler.ts`:
    - Implement change detection in `pollInventoryAll`: compare observed device attributes (`online`, `ip`, `name`) against stored device state.
    - Skip database writes for devices whose attributes haven't changed unless `last_seen_at` is older than 10 minutes (coarse heartbeat refresh).
    - Batch all required device updates into a single transaction execution.
- **Testing & Verification**:
  - Unit and integration tests verifying:
    - Polling interval configuration parsing in `config.test.ts`.
    - Change-detection logic preventing redundant database updates when device attributes are identical.
    - `batchUpdateDeviceObservations` transaction behavior.
    - Full suite regression pass across `@miwifi-webui/api`, `@miwifi-webui/router-core`, `@miwifi-webui/web`.

Out of:
- Changing the underlying database engine (PostgreSQL remains baseline per ADR 0002).
- Complex client-count-driven dynamic socket multiplexing.

## Acceptance criteria

1. PostgreSQL in `compose.yaml` (and local `compose-dev.yml`) is configured with `synchronous_commit=off` and tuned WAL flush delay (`wal_writer_delay=200ms`).
2. Polling intervals can be tuned via `POLLING_*` environment variables with sensible relaxed defaults.
3. When devices report the same state across successive inventory polls, zero database `UPDATE` queries are executed for those unchanged devices.
4. When device updates occur, they are committed in a single transaction batch rather than individual autocommit queries.
5. All automated test suites pass with zero regressions.

## Completion record

Status: `DONE` — completed 2026-09-21.

### Verification
- `pnpm -r typecheck`: 0 errors across all workspace packages (`contracts`, `router-core`, `api`, `web`).
- `pnpm --filter @miwifi-webui/api exec tsx --test test/config.test.ts test/observability-wiring.test.ts test/failure-modes.test.ts`: 20 tests pass (including new test suites for polling intervals, change detection skipping unchanged device writes, and single-transaction batch updates).
- `pnpm --filter @miwifi-webui/router-core test`: 59 tests pass.
- `pnpm --filter @miwifi-webui/web test`: 63 tests pass.
- `pnpm -r build`: Clean production builds across all packages (`dist/main.js`: 163.1 kB, Web JS: 305.92 kB).
- Compose configurations updated with asynchronous WAL commit parameters and environment variable defaults in `compose.yaml` (and local `compose-dev.yml`).

