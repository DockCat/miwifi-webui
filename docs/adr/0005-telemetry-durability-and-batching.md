# ADR 0005 — Telemetry Durability and Batching

Status: `ACCEPTED`

Date: `2026-09-21`

## Context

`miwifi-webui` runs continuous router observability in self-hosted homelab environments, frequently deployed on low-power mini-PCs, refurbished laptops, or consumer NAS storage (e.g., SATA SSDs or HDDs).

Production metrics gathered over 24 hours on node `omarchy` (Intel Core i7-3615QM, Beszel monitoring) revealed a critical disk I/O bottleneck:
- `writeTimePercent` sustained at 80% to 140%+;
- `writeAwaitMs` elevated to 32–50 ms;
- Total write throughput was low (< 0.4 MB/s), indicating the queue saturation was caused by high-frequency `fsync` system calls rather than large bulk transfers.

Investigations identified two compounding factors:
1. **Default PostgreSQL durability**: PostgreSQL defaults to `synchronous_commit = on`. Every single transaction commit forces an `fsync` of the Write-Ahead Log (WAL) to disk before acknowledging. On consumer drives without power-loss-protected DRAM caches, each fsync takes 10–40 ms.
2. **Unbatched, un-filtered device heartbeats**: The polling scheduler checked device inventory every 30 seconds and executed individual SQL `UPDATE` statements for each device, even when no status attributes (`online`, `ip`, `name`) had changed. For 30–50 devices, this triggered 30–50 individual autocommit transactions and corresponding fsync operations every interval.

## Decision

We adopt an asynchronous durability and write-batching policy for the application's PostgreSQL deployment and polling scheduler:

1. **Asynchronous WAL Commits in Docker Compose**:
   Configure the PostgreSQL service in `compose.yaml` and `compose-dev.yml` with:
   - `synchronous_commit = off`
   - `wal_writer_delay = 200ms`
   - `commit_delay = 2000` (microseconds)
   - `commit_siblings = 5`

2. **Application-Level Change Detection (Dirty Checking)**:
   In `PollingScheduler.pollInventoryAll`, skip updating existing device database records if the observed state (`online`, `ip`, `name`) has not changed since the last persistence and `last_seen_at` is reasonably fresh (< 10 minutes).

3. **Transaction Batching for Device Updates**:
   When device observations or presence transitions must be written to PostgreSQL, execute them inside a single transaction block (`BEGIN ... COMMIT`) or batched statement rather than individual autocommit queries.

4. **Configurable Polling Intervals**:
   Allow administrators to configure polling intervals via environment variables (`POLLING_STATUS_INTERVAL_MS`, `POLLING_INVENTORY_INTERVAL_MS`, `POLLING_TELEMETRY_INTERVAL_MS`), with default inventory polling relaxed from 30s to 60s.

## Rationale

- **Durability Trade-off**: `synchronous_commit = off` guarantees relational consistency and crash recovery: transactions are strictly ACID, WAL replay maintains referential integrity, and database corruption does not occur. The only consequence of an unclean operating system crash or power outage is the loss of the most recent ~200–600ms of committed transactions. Since telemetry and heartbeats are periodic sampled events, losing fractions of a second of transient samples during a sudden power cut is completely harmless for a router dashboard.
- **I/O Relief**: Grouping commits asynchronously reduces disk `fsync` operations by over 95%, eliminating the severe I/O queue wait on consumer hardware.
- **Reduced Write Amplification**: Filtering out unchanged device heartbeats prevents unnecessary writes to table blocks, indexes, and WAL for devices that remain statically connected for days or weeks.

## Consequences

### Positive
- Disk write wait (`writeTimePercent`) and disk await time drop by an estimated 90%+.
- Router polling consumes significantly fewer database connections and CPU cycles.
- Administrators can tune polling frequencies to match their homelab performance targets.

### Negative
- A sudden server power failure may discard up to 3× `wal_writer_delay` (approx. 600ms) of the most recent committed records (such as an audit entry or telemetry snapshot committed immediately prior to the crash).
- Application code must maintain clean change-detection logic when processing device updates.

## Alternatives considered

### Keep synchronous_commit = on and only batch at application level
Rejected. Even with application batching, periodic telemetry snapshots and presence events on slow disks still cause noticeable fsync latency spikes on low-end hardware. Combining both yields the best stability.

### Store telemetry snapshots in SQLite or memory-only ring buffers
Rejected. Preserves ADR 0002 single-persistence-engine simplicity. PostgreSQL easily handles the workload once synchronous fsync thrashing is removed.
