# Task 0006 — Limited Administration: Device Internet Block/Unblock

Status: `DONE`

Task ID: `0006`

Related plan: `docs/plans/0001-product-foundation.md` (Phase 6, sections 24-26)

## Objective

Implement the first (and only) v1 router mutation: block / restore a
device's Internet access. Per the plan's mutation flow: user confirmation
-> backend auth -> audit attempt -> router mutation -> read-back
verification -> audit result -> UI update. Only offered when the router's
capability profile includes device-internet-access-control.

## Security requirements

* Operation declared as WRITE effect in the catalog (never inferred from
  HTTP method).
* Mutation requires an authenticated session (no anonymous writes).
* Attempt + outcome audited; metadata carries device id/router id only —
  never stok, never the Wi-Fi/router password.
* Read-back verification: after the mutation, re-query device state; if
  the router's response cannot be confirmed, the UI shows UNKNOWN rather
  than trusting the mutation response alone.
* No other mutation endpoints exist (reboot/reset/Wi-Fi change stay out).

## Acceptance criteria

* block/unblock endpoint validates device belongs to the router.
* Audit rows recorded for attempt and success/failure.
* Read-back mismatch reports UNKNOWN (fails safe).
* Fixture-based tests cover: success, device-not-found, router offline,
  read-back mismatch.
* UI: confirmation dialog; internet-access column reflects state.
* All quality gates pass.

## Completion record

Status: `DONE` — completed 2026-09-05.

### Implementation summary

* Catalog: `blockInternet` / `unblockInternet` declared WRITE (reversible);
  runtime invariant assert in the control module (`catalog invariant
  violated` if a non-WRITE op is ever wired here); `smartHomeDeviceList`
  READ op for read-back verification. No other mutation endpoints exist.
* Domain (`access-control.ts`): block/unblock -> mutation -> read-back via
  device-list; mismatch or malformed read-back returns
  `readback_mismatch` with state `unknown` (fail-safe; UI never trusts the
  mutation response alone). Offline / router-error classified distinctly.
* Route: auth -> device-belongs-to-router check -> capability check
  (`device-internet-access-control` from the stored profile; 422 when
  absent) -> audit attempt -> mutation -> persist application-side state
  -> audit result.
* UI: Internet column in the devices table with per-device
  InternetAccessControl (confirmation dialog inline, disabled during
  flight, `unknown` surfaces as text); row-click navigation suppressed on
  the control cell.

### Verification

* 7 fixture-based domain tests: block+confirm, unblock+confirm, read-back
  mismatch -> unknown, malformed read-back -> unknown, device missing
  from read-back, router error, offline.
* Full gates: typecheck 0, lint 0, 83 tests, build OK.

### Follow-up work

Task 0007 — AI investigation (provider abstraction, read-only tools,
investigation records, evidence, privacy controls).
