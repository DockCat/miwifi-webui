# AGENTS.md

## Purpose

This file defines repository-level rules for coding agents working on `miwifi-webui`.

`miwifi-webui` is a self-hosted administration, observability, history, audit, and investigation application for Xiaomi / Redmi routers exposing compatible MiWiFi Web APIs.

Agents must treat the current repository as the source of implementation truth and must avoid silently expanding project scope.

## Source-of-truth order

Separate current-state facts from normative project decisions.

For facts about what currently exists, trust:

1. Current workspace files and current implementation.
2. Current Git state and verified command/test output.

For intended behavior and implementation constraints, use this precedence:

1. Accepted architecture decisions in `docs/adr/`.
2. The active task in `docs/tasks/`.
3. Accepted plans in `docs/plans/`.
4. `CONTEXT.md`.
5. General assumptions or historical discussion.

An active task may narrow the work being performed, but it must not silently violate an accepted ADR.

If implementation and accepted documentation materially disagree, do not silently choose one interpretation. Record the conflict and resolve whether the implementation or documentation must change.

## Before making changes

Before editing code:

1. Inspect the repository state.
2. Read `CONTEXT.md` if it exists.
3. Read the active task.
4. Read only the plans and ADRs relevant to that task.
5. Inspect existing code before proposing replacements.
6. Check git status and avoid overwriting unrelated work.
7. Keep the implementation scoped to the active task.

Do not perform large unrelated refactors while implementing a narrow feature.

## Documentation workflow

Project planning and task documentation lives under `docs/`.

### Plans

Location:

```text
docs/plans/
```

Plans describe:

* product direction;
* accepted architecture;
* delivery phases;
* security expectations;
* important constraints;
* cross-cutting design.

Plans should not be used as a running scratchpad.

### Tasks

Location:

```text
docs/tasks/
```

Tasks describe executable work.

Each task should contain:

* status;
* objective;
* scope;
* explicit out-of-scope items;
* implementation requirements;
* security requirements;
* acceptance criteria;
* verification expectations;
* completion record.

When a task is completed, keep the task file and update its status instead of deleting it.

Suggested task statuses:

* `DRAFT`
* `READY`
* `IN_PROGRESS`
* `BLOCKED`
* `DONE`

### CONTEXT.md

Resolved domain terminology and stable product concepts belong in `CONTEXT.md`.

Examples:

* Router;
* Mesh Node;
* Capability;
* Device Presence;
* Telemetry Snapshot;
* Audit Event;
* Investigation;
* Evidence.

Do not use `CONTEXT.md` for temporary implementation notes.

### ADRs

Location:

```text
docs/adr/
```

Create an ADR only for a decision that is meaningfully expensive, risky, or disruptive to reverse.

Good ADR subjects:

* backend-mediated router access;
* primary persistence technology;
* application authentication boundary;
* deployment topology.

Poor ADR subjects:

* component filename;
* icon library;
* ordinary CSS choice;
* routine refactoring;
* a temporary test helper.

## Architecture invariants

The following rules are architectural constraints unless superseded by a later accepted ADR.

### Browser-to-router boundary

The browser must not directly call Xiaomi router APIs.

Expected flow:

```text
Browser
   |
   v
Application Backend
   |
   v
MiWifiAdapter
   |
   v
Xiaomi Router
```

The backend owns:

* router authentication;
* router session management;
* credential handling;
* router request construction;
* capability probing;
* response normalization;
* polling;
* mutation classification;
* audit integration.

### MiWiFi upstream reference

The repository:

[https://github.com/RACErace/MiWiFi-API](https://github.com/RACErace/MiWiFi-API)

is a behavioral/documentation reference.

Do not turn it into an implicit runtime SDK dependency unless a future accepted decision explicitly changes this rule.

Implement a typed internal router abstraction.

### Capability-driven compatibility

Do not treat model-name recognition as the primary compatibility mechanism.

Compatibility should be based on safe runtime probing.

Unknown routers may operate with partial support.

Expected compatibility states:

* `SUPPORTED`
* `PARTIAL`
* `UNKNOWN`
* `INCOMPATIBLE`

Do not enable a router feature merely because a known model name normally supports it.

### Persistence

PostgreSQL is the persistence baseline.

Persistent application data includes, where applicable:

* application users;
* sessions;
* router metadata;
* encrypted router credentials;
* capability profiles;
* devices;
* device presence history;
* telemetry;
* audit events;
* investigations;
* evidence references.

### Deployment

Docker Compose is the baseline deployment model.

Do not introduce the following without an explicit accepted reason:

* Kubernetes;
* Redis;
* a message broker;
* distributed workers;
* service mesh infrastructure.

The v1 workload is intended for a single self-hosted installation.

## Security invariants

Security boundaries are part of feature correctness.

### Secrets

Never expose or log:

* router administration passwords;
* MiWiFi `stok`;
* `APP_MASTER_KEY`;
* AI provider API keys;
* application password hashes;
* Wi-Fi passwords;
* other secret-bearing router responses.

Do not commit real credentials.

Do not place production credentials in:

* fixtures;
* snapshots;
* example files;
* source code;
* test logs.

### Router credentials

Application-account credentials and router credentials are separate concepts.

Router credentials stored in PostgreSQL must be encrypted.

The encryption master key must live outside PostgreSQL.

Router passwords must never be sent to the frontend after initial submission.

`stok` must be considered backend-only ephemeral session material.

### Logging

Logs must avoid secret-bearing URLs.

Do not log complete MiWiFi request URLs when the URL can contain `stok`.

Prefer structured safe fields such as:

```text
router_id
operation
effect
status
duration_ms
request_id
```

### Audit metadata

Do not serialize arbitrary request bodies directly into audit metadata.

Audit metadata should use explicit allowlisted fields.

Audit events must not contain:

* password;
* `stok`;
* application master key;
* AI API key;
* raw authorization headers;
* session cookies.

### Router target validation

The backend must not become an arbitrary SSRF proxy.

Router onboarding should accept a router host/address rather than an arbitrary URL.

Router targets must be validated against the project's permitted local/private-network policy.

Do not blindly follow redirects to unvalidated destinations.

API paths should be generated by the adapter rather than supplied by the browser.

### Router effect classification

Every router operation must explicitly declare its effect class.

Allowed classes:

* `READ`
* `WRITE`
* `DISRUPTIVE`
* `DESTRUCTIVE`

Never infer safety from HTTP method.

A MiWiFi GET endpoint can still have side effects.

### Authentication

v1 may be single-user, but it must retain a genuine application authentication boundary.

Expected direction:

* first-run bootstrap administrator;
* no public signup;
* Argon2id password hashing;
* server-side session state;
* HttpOnly cookies;
* session rotation;
* session revocation;
* CSRF / origin protection for state changes.

Do not replace the application login boundary with the Xiaomi router password.

### AI

AI is disabled by default.

External data egress requires explicit administrator configuration.

External providers always receive pseudonymized context: MAC addresses, IP addresses, and raw device names are replaced with stable aliases, with no per-category opt-out. The alias-to-original legend is stored with the local investigation record only and must never be sent to a provider.

v1 AI investigation is read-only.

AI tools must not initially include:

* block-device;
* unblock-device;
* reboot-router;
* change-Wi-Fi;
* reset-router;
* other router mutations.

Agent tools should expose narrow, structured, read-only application data rather than unrestricted database access.

## Router adapter rules

Router-specific HTTP behavior belongs behind the router adapter abstraction.

Do not scatter Xiaomi endpoint URLs throughout:

* Fastify routes;
* React components;
* persistence code;
* AI tools.

Adapter responsibilities should include:

* compatibility probe;
* login;
* session refresh;
* router information;
* health;
* device inventory;
* traffic;
* Wi-Fi state;
* supported mutation operations.

Responses should be normalized into application-domain types.

Unknown or malformed router responses must fail safely.

## Data-model rules

Prefer internal synthetic identifiers for application entities.

Do not use router IP address as a permanent router primary key.

Do not use model name as a router primary key.

Do not assume MAC address is a permanent human device identity.

Persist timestamps consistently.

UI locale/timezone formatting should remain separate from database storage semantics.

### Telemetry

Telemetry represents sampled operational state.

UI refreshes must not implicitly create extra telemetry rows.

### Device Presence

Presence represents transitions such as:

* first seen;
* online;
* offline.

Prefer event-based presence history.

### Audit

Audit is logically append-only during normal operation.

Normal feature APIs should not casually update or delete individual historical audit records.

Retention or explicit administrative purge behavior should be separate and auditable.

## Scope discipline

Prefer the smallest implementation that satisfies the active task.

Do not add infrastructure because it may theoretically be useful later.

Avoid premature abstractions unless they protect an already-accepted boundary.

Do not implement multi-tenancy in v1.

Do not implement LAN-wide automatic scanning unless a future task explicitly introduces it.

Do not implement destructive router operations unless a future task explicitly scopes and reviews them.

Do not add autonomous AI remediation in v1.

## Testing expectations

Testing is required for architectural and security boundaries, not only happy-path UI behavior.

### Mock and fixture first

Router integration must be testable without a real router.

Create deterministic fixtures and mock adapters.

### Real-router tests

Real-router tests must be explicitly opt-in.

Tests that mutate a real router must never execute as part of the default test suite.

Real-router credentials must never be stored in source control.

### Security regressions

Add regression coverage ensuring secrets do not appear in:

* HTTP responses;
* logs;
* audit metadata;
* snapshots;
* thrown errors.

Sensitive test tokens should be recognizable sentinel values so accidental leakage is detectable.

### Compatibility tests

Test:

* supported router;
* partially supported router;
* unknown model with compatible API;
* unsupported endpoint;
* token expiry;
* authentication failure;
* malformed response;
* router offline behavior.

## Repository hygiene

Do not modify or commit project-tool runtime directories such as:

```text
.gstack/
.codegraph/
```

unless the repository explicitly changes that policy later.

Do not commit:

* generated build output;
* secrets;
* database data volumes;
* temporary logs;
* local runtime credentials.

## Working with an active task

When implementing a task:

1. Change task status to `IN_PROGRESS` if appropriate.
2. Implement only the required scope.
3. Run the required verification.
4. Record meaningful deviations.
5. Update task status to `DONE` only when acceptance criteria pass.
6. Record verification results in the task completion section.
7. Do not mark incomplete behavior as complete.

If the implementation exposes a previously unknown architectural conflict, stop expanding the implementation and document the decision needed before proceeding.
