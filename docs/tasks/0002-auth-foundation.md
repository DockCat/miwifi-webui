# Task 0002 — Security / Auth Foundation

Status: `DONE`

Task ID: `0002`

Related plan: `docs/plans/0001-product-foundation.md` (Phase 2)
Related ADRs: ADR 0003 (application auth boundary), ADR 0002 (PostgreSQL)

## Objective

Establish the application authentication boundary: first-run bootstrap
administrator (localhost-restricted), Argon2id password hashing, server-side
sessions with HttpOnly cookies, session rotation/revocation, idle + absolute
timeouts, CSRF/origin protection for mutations, append-only audit events,
router-credential envelope encryption (APP_MASTER_KEY outside PostgreSQL),
and local administrative recovery (CLI).

## Scope

In: `app_user` / `app_session` / `audit_event` migrations; auth + bootstrap
+ audit routes; envelope crypto; password policy; CLI create-admin /
reset-password; PG-backed integration tests; secret-leak regression tests.

Out of: multi-user roles, email reset, router onboarding (Task 0003).

## Acceptance criteria

* bootstrap admin only when user table empty and request is from loopback;
  permanently closed afterwards (409);
* login issues rotated session, revokes previous sessions, HttpOnly cookie;
* idle (~30 min) and absolute (~12 h) expiry enforced;
* password change revokes all sessions;
* non-GET /api requests require matching Origin (CSRF defense);
* Argon2id hashing; plaintext passwords never in responses, logs, or audit;
* audit events append-only with allowlisted metadata only;
* all quality gates pass.

## Completion record

Status: `DONE` — completed 2026-09-05.

### Implementation summary

* Migrations `0002-auth.sql` (`app_user`, `app_session` — token stored as
  sha256 only) and `0003-audit.sql` (append-only `audit_event`).
* Argon2id password hashing (`@node-rs/argon2`, OWASP parameters m=19MiB
  t=2 p=1); minimal password policy (>=10 chars).
* Bootstrap route: loopback-only while user table empty; 409 permanently
  once an administrator exists (ADR 0003).
* Login/logout/session routes; session rotation on login (old tokens
  revoked), idle ~30 min sliding + ~12 h absolute expiry.
* Password change requires current password, revokes all sessions.
* CSRF/origin defense: non-GET requests with an Origin header must match
  Host; non-browser clients unaffected.
* HttpOnly + SameSite=Lax cookies (Secure under HTTPS).
* Envelope encryption (AES-256-GCM, per-secret DEK sealed under
  APP_MASTER_KEY) ready for router credentials.
* Local recovery CLI: `admin:create` / `admin:reset-password` (password via
  ADMIN_PASSWORD env, never argv); audit-logged.
* Audit writer with metadata key blocklist scrub.

### Verification

* `pnpm typecheck/lint/test/build` — all pass (40 tests total, 24 in api).
* Auth integration tests against a throwaway PostgreSQL database:
  bootstrap lifecycle, login rotation replay, CSRF mismatch/match, password
  change + revocation, audit-trail secret-leak assertions (sentinel
  passwords never appear in responses or audit rows).
* Found and fixed a real bug during verification: repository row-mapping —
  snake_case columns were selected without aliases so `passwordHash` was
  `undefined` at runtime while TypeScript believed the shape; verify
  therefore always failed. Fixed with quoted camelCase aliases in all
  user/session queries.

### Follow-up work

Task 0003 — MiWifiAdapter / compatibility-probe foundation.
