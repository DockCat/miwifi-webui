# Architecture Decision Records

Architecture Decision Records document important technical decisions that are expensive, risky, or disruptive to reverse.

They are intentionally short compared with product plans.

## When to create an ADR

Create an ADR when a decision affects areas such as:

* system trust boundary;
* persistence architecture;
* identity/authentication architecture;
* deployment topology;
* fundamental integration boundary;
* security model.

## When not to create an ADR

Do not create ADRs for ordinary reversible choices such as:

* component library;
* single dependency version;
* filename;
* formatting rule;
* minor refactoring;
* one API route name;
* temporary workaround.

## Status

Recommended statuses:

* `PROPOSED`
* `ACCEPTED`
* `SUPERSEDED`
* `REJECTED`

An accepted ADR should not be edited to pretend the original decision never existed.

If a fundamental decision changes, normally:

1. create a new ADR;
2. mark the previous ADR `SUPERSEDED`;
3. link the two records.

Minor typo/clarity fixes are acceptable.

## ADR template

```markdown
# ADR NNNN — Title

Status: PROPOSED

Date: YYYY-MM-DD

## Context

What problem or constraint requires a decision?

## Decision

What are we deciding?

## Rationale

Why is this the preferred choice?

## Consequences

What becomes easier or harder?

## Alternatives considered

What other approaches were considered?

## Revisit when

Under which material circumstances should this decision be reconsidered?
```

## Current ADRs

* `0001-backend-mediated-router-access.md`
* `0002-postgresql-persistence.md`
* `0003-application-auth-boundary.md`
* `0004-docker-compose-deployment.md`
