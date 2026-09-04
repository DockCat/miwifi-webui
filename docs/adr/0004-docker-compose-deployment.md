# ADR 0004 — Docker Compose Deployment

Status: `ACCEPTED`

Date: `2026-09-04`

## Context

The target audience is primarily home/prosumer/homelab administrators operating the product inside or near the managed LAN.

The application requires:

* browser UI;
* long-running backend;
* PostgreSQL;
* background router polling;
* durable history;
* access from the backend to local router addresses.

The product does not currently require horizontal scaling or distributed job processing.

## Decision

Docker Compose is the baseline deployment model.

Conceptual service topology:

```text
web/proxy
api
postgres
```

Background router polling and scheduled retention work may initially run inside the API/backend service.

The deployment should use persistent PostgreSQL storage.

The application does not require:

* Kubernetes;
* Redis;
* message queue;
* distributed worker fleet.

Those components may only be added later when justified by real requirements.

## Rationale

Docker Compose provides:

* straightforward self-hosting;
* repeatable dependency setup;
* PostgreSQL lifecycle management;
* controlled networking;
* clear persistent-volume handling;
* a familiar deployment model for homelab/prosumer users.

A single long-running backend fits router polling and local-network communication better than a serverless request model.

## Consequences

### Positive

* simple local deployment;
* predictable service connectivity;
* straightforward PostgreSQL setup;
* backend has stable LAN access;
* development/prod topology can remain conceptually similar.

### Negative

* Docker becomes a normal installation prerequisite;
* users must manage persistent volumes/backups;
* LAN HTTPS still requires deployment guidance;
* single-host failure affects the complete application.

## Network exposure

The database should not be exposed publicly.

Only necessary application entry ports should be exposed on the host.

The application itself is intended for:

* localhost;
* trusted LAN.

The product does not provide its own Internet-facing tunnel.

## HTTPS

LAN authentication should use HTTPS where practical.

TLS termination may be provided through:

* a Compose web/proxy service;
* an administrator-controlled reverse proxy;
* another documented trusted deployment option.

The exact proxy vendor is not part of this ADR.

## Alternatives considered

### Native host installation only

Rejected as the baseline.

It increases differences between user environments and complicates PostgreSQL setup.

### Kubernetes

Rejected for v1.

It adds disproportionate operational complexity for the target audience.

### Serverless/cloud architecture

Rejected.

The product requires local LAN access, polling, and a durable self-hosted control process.

### Desktop-only packaged application

Not selected as the initial baseline.

A web application accessed from localhost/LAN better matches multi-device administration.

## Revisit when

Reconsider if:

* a desktop-native distribution becomes a major product requirement;
* horizontal scale is proven necessary;
* multi-site cloud management becomes a confirmed product direction;
* background workload requires independently scalable workers.

Until then, Docker Compose remains the deployment baseline.
