# miwifi-webui

`miwifi-webui` is a self-hosted web administration, observability, history, and investigation interface for Xiaomi routers exposing compatible MiWiFi Web APIs.

The project is inspired by the operational experience of network management products such as UniFi, while remaining an independent implementation designed specifically around Xiaomi / Redmi routers and the MiWiFi API ecosystem.

> Project status: **early development / architecture established**.
> The repository is currently being bootstrapped. Features described as planned are not necessarily implemented yet.

## Goals

The project aims to provide a local-first administration console for home, prosumer, and homelab environments.

Primary goals:

* Display router and network health.
* Discover and display connected devices.
* Track device presence over time.
* Persist operational telemetry.
* Maintain application-level security and administrative audit records.
* Provide limited, explicitly classified router administration actions.
* Support compatible Xiaomi / Redmi routers through runtime capability detection.
* Provide evidence-backed AI-assisted network investigation.
* Keep router credentials and router session tokens inside the backend trust boundary.
* Run as a self-hosted Docker Compose application.
* Support both Simplified Chinese and English UI foundations.

## Non-goals for v1

The first version is intentionally not intended to be:

* A public SaaS control plane.
* An MSP multi-tenant platform.
* A replacement firmware project.
* A packet capture or deep packet inspection system.
* A DNS browsing-history tracker.
* An autonomous AI network administrator.
* A generic arbitrary-URL HTTP proxy.
* A system that guarantees every MiWiFi API feature on every Xiaomi router model.
* A Kubernetes or distributed microservice deployment.

## Architecture

The fundamental trust boundary is:

```text
Browser
   |
   v
Web / reverse proxy
   |
   v
Fastify backend
   |
   +----> PostgreSQL
   |
   +----> MiWifiAdapter
              |
              v
        Xiaomi Router
        local MiWiFi API
```

The browser must never communicate directly with the Xiaomi router API.

All router authentication, router session management, API normalization, capability detection, polling, mutation classification, and credential handling belong to the backend.

## Planned technology baseline

Frontend:

* React
* Vite
* TypeScript

Backend:

* Fastify
* TypeScript

Persistence:

* PostgreSQL
* Database migrations

Deployment:

* Docker Compose
* Persistent PostgreSQL storage
* A web / reverse-proxy entry point
* A backend API service
* A PostgreSQL service

Realtime UI updates:

* Server-Sent Events where appropriate

The project does not currently require Redis, a message queue, Kubernetes, SSR, or a serverless runtime.

## Router compatibility

The project uses the following upstream repository as a behavioral API reference:

[https://github.com/RACErace/MiWiFi-API](https://github.com/RACErace/MiWiFi-API)

That repository is documentation/reference material. It is not treated as a runtime SDK dependency.

`miwifi-webui` should implement its own typed router abstraction.

Compatibility is **capability-driven**, not based on a hardcoded router-model allowlist.

A router may be classified as:

* `SUPPORTED`
* `PARTIAL`
* `UNKNOWN`
* `INCOMPATIBLE`

An unknown model should not automatically be rejected if it can successfully complete the MiWiFi compatibility probe.

Feature availability should be determined by safe runtime capability detection.

## Security model

Important security invariants include:

* Router administration passwords must never be exposed to the frontend.
* MiWiFi `stok` session tokens must never be exposed to the frontend.
* Router passwords, `stok`, application master keys, and AI API keys must not appear in application logs.
* Router passwords and application-account passwords are separate credentials.
* Router credentials stored in PostgreSQL must be encrypted using an application-level master key stored outside PostgreSQL.
* `stok` should be treated as ephemeral backend session state rather than ordinary persisted application data.
* Router targets must be restricted to explicitly permitted local/private network targets.
* Backend router requests must not accept arbitrary user-provided URLs.
* Router operations must have an explicit effect classification rather than relying on HTTP GET/POST semantics.
* External AI data egress is disabled until explicitly configured by the administrator.
* AI investigation is read-only in v1.
* Real-router mutation tests must never run by default.

## Authentication

v1 is designed around a single application administrator.

That does not mean authentication is skipped.

The application should provide:

* first-run administrator bootstrap;
* a real application login boundary;
* password hashing using Argon2id;
* server-side sessions;
* HttpOnly session cookies;
* session revocation;
* CSRF / origin protection for mutations;
* local administrative recovery rather than public email-based reset.

Application credentials and Xiaomi router credentials must remain independent.

## Router data

The application distinguishes between three important categories of historical data.

### Telemetry Snapshot

Periodic operational state such as:

* CPU / memory information where available;
* WAN state;
* Wi-Fi state;
* traffic statistics;
* active device count;
* Mesh status;
* other safe normalized router health metrics.

### Device Presence

State transitions such as:

* first seen;
* online;
* offline;
* last seen.

Presence history should primarily be event-based rather than duplicating a complete row on every UI refresh.

### Audit Event

Application security and administrative events such as:

* application login;
* logout;
* router onboarding;
* router mutation attempts;
* router mutation success or failure;
* administrative configuration actions;
* AI investigation activity.

Audit metadata must be sanitized and must never contain credentials or router session tokens.

## Default retention direction

Initial retention defaults:

* high-resolution telemetry: approximately 90 days;
* device presence history: longer-term, using compact event representation;
* security and administrative audit events: approximately 1 year;
* AI investigation content: approximately 30 days by default.

Retention periods should ultimately be configurable.

## Router administration

The product is observability-first.

The initial router mutation scope should remain deliberately small.

The first mutation candidates are:

* block a device's Internet access;
* restore a device's Internet access.

More disruptive functions such as the following are outside the initial mutation scope:

* router reboot;
* factory reset;
* firmware update;
* Wi-Fi reconfiguration;
* Mesh membership changes;
* country-code changes.

Every router operation must explicitly declare one of the following effect classes:

* `READ`
* `WRITE`
* `DISRUPTIVE`
* `DESTRUCTIVE`

The HTTP method used by the MiWiFi API must not determine this classification.

## AI investigation

AI is an investigation layer, not an autonomous administrator.

The initial AI agent may use controlled read-only tools to:

* inspect router health;
* inspect current device state;
* query device presence history;
* query telemetry;
* query application events;
* correlate network events;
* produce findings and remediation suggestions.

The AI must not initially have tools capable of:

* blocking a device;
* rebooting the router;
* modifying Wi-Fi settings;
* changing firewall/network policy;
* resetting the router.

AI findings should be linked to local evidence records whenever possible.

Example:

```text
Finding:
A device lost connectivity at approximately 14:32.

Evidence:
- presence_event #813
- telemetry_snapshot #29102
- audit/event #144
```

The UI should eventually allow evidence to be inspected independently of the AI-generated explanation.

## AI privacy

AI is disabled by default.

No external provider should receive router or device information until the administrator explicitly configures and enables that provider.

External providers should receive minimized or pseudonymized context by default.

Sensitive fields such as the following should not be transmitted automatically:

* router password;
* `stok`;
* Wi-Fi password;
* application master key;
* AI provider credentials;
* serial numbers;
* raw secret-bearing URLs.

MAC addresses, IP addresses, and raw device names should be exposed externally only when the investigation genuinely requires them and the administrator has enabled the relevant data category.

## UI direction

The interface is **UniFi-inspired**, not a UniFi clone.

Desired characteristics:

* persistent administration navigation;
* operational dashboard;
* dense but legible device tables;
* strong status hierarchy;
* health indicators;
* device drill-down;
* event timelines;
* consistent severity and state badges;
* evidence-focused investigation screens.

Do not copy:

* Ubiquiti branding;
* logos;
* proprietary icons;
* product names;
* exact screen layouts.

The primary experience is desktop-oriented while remaining practical on tablets and mobile devices for monitoring and incident investigation.

## Internationalization

The UI should have an internationalization foundation from the beginning.

Initial languages:

* Simplified Chinese (`zh-CN`)
* English (`en`)

The default language should normally follow the browser locale.

Dates should be stored consistently in the backend/database and rendered according to the user's local timezone.

Router-specific raw enums should not be exposed directly as user-facing labels.

## Documentation

Project documentation is organized under `docs/`.

* [Documentation index](docs/README.md)
* [Product foundation plan](docs/plans/0001-product-foundation.md)
* [Project bootstrap task](docs/tasks/0001-project-bootstrap.md)
* [Architecture Decision Records](docs/adr/README.md)
* [Domain context](CONTEXT.md)

Plans describe accepted product and architectural direction.

Tasks describe executable implementation work and acceptance criteria.

ADRs are reserved for decisions that are expensive or risky to reverse.

## Development status

The project is currently in the bootstrap stage.

Do not assume development commands, package-manager commands, ports, or environment variables exist until they are introduced by implementation and documented in this README.

## Upstream reference

MiWiFi API behavioral reference:

[https://github.com/RACErace/MiWiFi-API](https://github.com/RACErace/MiWiFi-API)

The project should preserve attribution where appropriate while maintaining an independent implementation boundary.

## License

Project licensing has not yet been finalized.

Do not assume that the license of an upstream reference repository automatically determines the license of this repository.
