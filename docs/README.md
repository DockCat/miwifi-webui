# Documentation

This directory contains the durable planning, task, and architecture documentation for `miwifi-webui`.

The goal is to keep implementation work traceable without turning the repository into a collection of stale design documents.

## Structure

```text
docs/
├── README.md
├── plans/
│   └── 0001-product-foundation.md
├── tasks/
│   └── 0001-project-bootstrap.md
└── adr/
    ├── README.md
    ├── 0001-backend-mediated-router-access.md
    ├── 0002-postgresql-persistence.md
    ├── 0003-application-auth-boundary.md
    └── 0004-docker-compose-deployment.md
```

Stable domain terminology is maintained separately in:

```text
CONTEXT.md
```

Repository-level agent rules are maintained in:

```text
AGENTS.md
```

## Document types

### Plans

Directory:

```text
docs/plans/
```

Plans describe accepted high-level direction.

A plan may contain:

* product goals;
* architecture;
* delivery phases;
* security principles;
* scope boundaries;
* operational assumptions;
* major risks.

Plans should describe outcomes and constraints rather than low-level temporary implementation details.

Suggested status values:

* `DRAFT`
* `PROPOSED`
* `ACCEPTED`
* `SUPERSEDED`

An accepted plan remains in the repository after implementation.

If a later plan replaces it, mark the older plan as `SUPERSEDED` and link to the replacement.

## Tasks

Directory:

```text
docs/tasks/
```

Tasks describe bounded executable work.

A good task contains:

* objective;
* current state;
* in-scope work;
* out-of-scope work;
* security requirements;
* expected affected areas;
* acceptance criteria;
* verification;
* completion record.

Suggested task statuses:

* `DRAFT`
* `READY`
* `IN_PROGRESS`
* `BLOCKED`
* `DONE`

Do not mark a task `DONE` merely because code was written.

It is `DONE` only after its acceptance criteria and required verification pass.

Keep completed task files for historical traceability.

## ADRs

Directory:

```text
docs/adr/
```

Architecture Decision Records are reserved for decisions that are costly or risky to reverse.

Examples:

* system trust boundary;
* persistence technology;
* identity/authentication boundary;
* deployment topology.

Do not create ADRs for ordinary implementation details such as:

* component filename;
* UI icon library;
* formatting rule;
* temporary refactoring;
* routine dependency upgrade.

See:

[ADR guidelines](adr/README.md)

## CONTEXT.md

`CONTEXT.md` contains shared product vocabulary.

It answers questions such as:

* What is a Router?
* What is a Capability?
* How is `PARTIAL` compatibility different from `INCOMPATIBLE`?
* What is a Telemetry Snapshot?
* What is an Audit Event?
* What is Evidence?
* What does a Mutation effect mean?

It should describe stable concepts, not implementation progress.

## Numbering

Plans, tasks, and ADRs use four-digit prefixes.

Examples:

```text
0001-product-foundation.md
0002-router-adapter.md
0003-device-history.md
```

Numbers are identifiers, not semantic version numbers.

Do not renumber existing documents after they have been referenced.

## Links

Current documents:

### Plans

* [0001 — Product Foundation](plans/0001-product-foundation.md)

### Tasks

* [0001 — Project Bootstrap](tasks/0001-project-bootstrap.md)
* [0002 — Security / Auth Foundation](tasks/0002-auth-foundation.md)
* [0003 — MiWifiAdapter / Compatibility-Probe Foundation](tasks/0003-adapter-foundation.md)
* [0004 — Observability](tasks/0004-observability.md)
* [0005 — Operational UI](tasks/0005-operational-ui.md)
* [0006 — Limited Administration](tasks/0006-mutations.md)
* [0007 — AI Investigation](tasks/0007-ai-investigation.md)
* [0008 — Hardening](tasks/0008-hardening.md)

### Operations

* [Backup and Restore](backup-restore.md)

### ADRs

* [ADR guidelines](adr/README.md)
* [0001 — Backend-mediated Router Access](adr/0001-backend-mediated-router-access.md)
* [0002 — PostgreSQL Persistence](adr/0002-postgresql-persistence.md)
* [0003 — Application Authentication Boundary](adr/0003-application-auth-boundary.md)
* [0004 — Docker Compose Deployment](adr/0004-docker-compose-deployment.md)

## Documentation update rule

When implementation reveals that an accepted assumption is wrong:

1. update the relevant task with the discovered problem;
2. determine whether the issue is:

   * implementation detail;
   * product-context correction;
   * architecture decision;
3. update `CONTEXT.md` for stable vocabulary corrections;
4. create or supersede an ADR only when the decision is hard to reverse;
5. update the product plan if the overall accepted direction materially changes.

Do not silently let the implementation and accepted documentation diverge.
