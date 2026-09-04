# ADR 0002 — PostgreSQL Persistence

Status: `ACCEPTED`

Date: `2026-09-04`

## Context

`miwifi-webui` requires durable state beyond transient router responses.

Expected persistent domains include:

* application authentication;
* sessions;
* routers;
* encrypted router credentials;
* router capabilities;
* devices;
* device presence events;
* telemetry;
* audit events;
* AI investigations;
* evidence relationships.

Telemetry and historical data make persistence a first-class product concern.

The project will be deployed through Docker Compose, making an embedded-only database less necessary.

## Decision

PostgreSQL is the primary persistence technology.

Schema changes must be managed through committed migrations.

Application code should access PostgreSQL through a deliberate data-access layer selected during implementation.

The ORM/query-builder choice is not part of this ADR.

## Rationale

PostgreSQL provides:

* strong relational modeling;
* reliable transactions;
* indexing;
* mature JSON support where useful;
* good support for historical queries;
* straightforward Docker deployment;
* a clear path for future data growth.

It can support the anticipated v1 scale without introducing a specialized time-series service.

## Consequences

### Positive

* one durable persistence system;
* robust relational constraints;
* strong migration ecosystem;
* appropriate audit/history capabilities;
* future extension to multiple routers remains practical.

### Negative

* deployment requires a separate database service;
* backups are an operational responsibility;
* local development requires PostgreSQL/Compose;
* database migrations must be maintained.

## Data principles

PostgreSQL should distinguish:

* telemetry snapshots;
* device-presence events;
* audit events.

These should not be collapsed into one generic event table solely for convenience unless a later design proves that model appropriate.

## Security consequences

Database backups may contain:

* network metadata;
* device history;
* encrypted router credentials;
* audit history.

Encryption keys used to decrypt router credentials must not be stored in the same PostgreSQL database.

## Alternatives considered

### SQLite

Rejected as the baseline after project requirements were clarified.

SQLite could support some initial workloads, but PostgreSQL better matches the chosen Docker Compose deployment and expected historical data model.

### Dedicated time-series database

Rejected for v1.

Telemetry volume does not currently justify an additional datastore.

### Multiple persistence services

Rejected.

Operational simplicity is a goal for the self-hosted audience.

## Revisit when

Reconsider if measured production workload demonstrates that PostgreSQL cannot meet required telemetry/history performance or if an embedded single-process deployment becomes a primary product requirement.
