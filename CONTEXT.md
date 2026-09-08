# Project Context

## Project

Name:

`miwifi-webui`

Purpose:

A self-hosted web application for operating, observing, auditing, and investigating Xiaomi / Redmi routers exposing compatible MiWiFi Web APIs.

Primary audience:

* home network administrators;
* prosumers;
* homelab operators.

v1 assumes one administrative trust domain rather than an MSP / multi-tenant model.

## Product principles

The product is:

* local-first;
* observability-first;
* capability-driven;
* security-conscious;
* evidence-oriented;
* conservative about router mutations;
* conservative about external AI data egress.

The product should remain useful even when AI is completely disabled.

## Trust boundary

Router access occurs only through the backend.

```text
Browser
   |
   v
miwifi-webui backend
   |
   v
MiWifiAdapter
   |
   v
Xiaomi Router
```

The browser does not receive router credentials or MiWiFi session tokens.

## Router

A **Router** is a Xiaomi / Redmi network router being managed by `miwifi-webui`.

A router has an application-owned synthetic identifier.

A router's IP address, hostname, hardware model, ROM version, and capability profile are attributes rather than identity keys.

## Primary Router

The **Primary Router** is the main router represented by the initial v1 product experience.

v1 UX may focus on a single primary router / Mesh environment.

The data model should retain `router_id` boundaries so future support for multiple independent routers does not require a fundamental persistence redesign.

## Mesh Node

A **Mesh Node** is a router or access node participating in the primary router's Mesh environment.

A Mesh node is not automatically treated as an independent administrative tenant.

Mesh capability is discovered rather than assumed.

## MiWiFi API

**MiWiFi API** refers to the local router Web API family documented by community resources such as:

[https://github.com/RACErace/MiWiFi-API](https://github.com/RACErace/MiWiFi-API)

That repository is used as behavioral reference documentation.

It is not considered the application's runtime SDK.

## MiWifiAdapter

`MiWifiAdapter` is the backend abstraction responsible for Xiaomi-router-specific behavior.

Responsibilities include:

* compatibility probing;
* authentication;
* MiWiFi login transformation;
* router session handling;
* request construction;
* safe response parsing;
* capability discovery;
* normalized router state;
* supported router mutations.

Router-specific endpoint strings should remain inside the adapter layer.

## Compatibility Probe

A **Compatibility Probe** is a sequence of safe operations used to determine whether a router exposes enough compatible MiWiFi behavior to be managed.

A probe may inspect:

* initialization information;
* hardware identifier;
* model;
* ROM / firmware version;
* supported modules;
* Mesh support;
* radio capabilities;
* device-list support;
* traffic-statistics support;
* administration capabilities.

The probe must favor read-only operations.

A router must not be rejected solely because its model string is unfamiliar.

## Capability

A **Capability** represents a router behavior that has been discovered to be usable.

Examples:

* device inventory;
* traffic statistics;
* Mesh;
* Wi-Fi 6 information;
* 160 MHz support;
* Internet block/unblock control.

Capabilities are runtime facts about a router integration.

They must not be inferred solely from a model-name whitelist.

## Compatibility Status

A router may have one of four high-level compatibility states.

### SUPPORTED

The router successfully completes required baseline probes and its expected core features are available.

### PARTIAL

The router is usable, but one or more optional or expected APIs are unavailable.

### UNKNOWN

The router model or firmware is not recognized, but probing is still in progress or there is not yet enough evidence to classify support.

### INCOMPATIBLE

The router cannot satisfy the application's minimum required authentication/protocol behavior.

## Router Credential

A **Router Credential** is secret authentication material used to authenticate to the Xiaomi router.

It is independent from the `miwifi-webui` application account.

Router credentials:

* belong to the backend security boundary;
* must not be exposed back to the frontend;
* must be encrypted at rest if persisted.

## Application Credential

An **Application Credential** is used to authenticate a human administrator to `miwifi-webui`.

The application password is not the Xiaomi router password.

v1 begins as a single-user application but maintains a real login/session boundary.

## stok

`stok` is MiWiFi router session material returned after router authentication.

It is sensitive.

Rules:

* backend-only;
* not returned to the frontend;
* not written to normal logs;
* not included in audit metadata;
* not treated as ordinary historical data.

When router authentication expires, the backend should obtain a fresh router session using the encrypted router credential.

## Device

A **Device** is a client observed on the managed network.

Application identity should use a synthetic `device_id`.

MAC address may be an important observation attribute but should not be treated as universally permanent human identity because modern devices may rotate/private-randomize MAC addresses.

## Device Presence

**Device Presence** represents when a device is observed entering or leaving an online state.

Important events include:

* `FIRST_SEEN`
* `ONLINE`
* `OFFLINE`

Presence history is event-oriented.

It is distinct from periodic telemetry.

## Telemetry Snapshot

A **Telemetry Snapshot** is a persisted sample of operational router/network state.

Examples:

* CPU/memory information;
* WAN state;
* Wi-Fi state;
* current device count;
* traffic counters;
* Mesh state;
* health measurements.

UI requests do not themselves define telemetry sampling frequency.

Opening or refreshing a dashboard should not cause extra historical rows to be persisted.

Initial direction:

* current-state polling around 15 seconds;
* device inventory around 30 seconds;
* persisted telemetry around 60 seconds.

These values should eventually be configurable.

## Audit Event

An **Audit Event** records security-relevant or administrative application activity.

Examples:

* administrator login;
* logout;
* failed login;
* router onboarding;
* configuration attempt;
* router mutation;
* AI investigation started;
* AI tool invocation;
* administrative purge/export.

Audit events should normally be append-only.

Audit metadata must be explicitly sanitized.

Secrets must never appear in audit events.

## Mutation

A **Mutation** is an operation capable of changing router or application state.

Router operations must not be classified based only on HTTP method.

Every router operation must declare an explicit effect.

## Operation Effect

Allowed router effect classifications:

### READ

Expected not to alter router/network state.

### WRITE

Changes state but is intended to be reversible and non-disruptive.

### DISRUPTIVE

Can temporarily interrupt network or router operation.

### DESTRUCTIVE

May cause irreversible loss, reset, firmware risk, or major administrative disruption.

Initial v1 router mutation scope should include only clearly reversible functions, beginning with device Internet access block/unblock where compatibility is verified.

## Investigation

An **Investigation** is a structured analysis session initiated by a human administrator.

It may combine:

* router state;
* telemetry;
* device presence;
* events;
* audit records.

An investigation is not automatically an authorization to modify the router.

## AI Investigation

**AI Investigation** is the optional use of an AI model to interpret application-owned evidence.

v1 AI behavior is read-only.

It may:

* query approved investigation tools;
* correlate evidence;
* explain anomalies;
* produce suggested next steps.

It may not directly execute router mutations.

## Evidence

**Evidence** is a locally stored record used to support an investigation finding.

Examples:

* telemetry snapshot;
* presence event;
* audit event;
* normalized router event.

AI findings should reference evidence identifiers whenever practical.

Users should be able to inspect evidence independently of the generated conclusion.

## Local AI Provider

A **Local AI Provider** is an AI inference endpoint operating within an administrator-controlled local environment.

It may use an OpenAI-compatible protocol or another future provider abstraction.

Local-provider support is optional and must not become a mandatory dependency of core router functionality.

## External AI Provider

An **External AI Provider** sends investigation context outside the local application environment.

External AI is disabled until explicitly configured.

The administrator controls whether an external provider is enabled. Every
external request aliases MAC addresses, IP addresses, and original device
names; there is no per-category opt-out. The alias legend remains local.

## AI Data Minimization

External AI context should be minimized by default.

Prefer aliases such as:

```text
router_01
device_01
device_02
```

over unnecessary direct identifiers.

Do not automatically send:

* router credentials;
* `stok`;
* Wi-Fi passwords;
* application master keys;
* AI provider credentials;
* raw secret-bearing request URLs.

MAC addresses, IP addresses, serials, and original device names should be treated as potentially sensitive network identifiers.

The application never sends those raw network identifiers to an external
provider. Tools omit serials, and the privacy layer aliases MACs, IPs, and
device names before the first request and on replayed history.

## Retention

Initial retention direction:

### Telemetry

Approximately 90 days of high-resolution telemetry.

### Device Presence

Longer-lived compact presence events.

### Audit

Approximately one year for application security/admin audit.

### AI Investigation Content

Approximately 30 days by default.

Retention should ultimately be configurable.

## Application User

v1 starts with one administrator.

No public self-registration.

Initial-account creation happens through a first-run bootstrap process.

The persistence model may use a normal user entity so future multi-user support does not require replacing the authentication architecture.

## Session

A **Session** is server-side application login state.

Initial security direction:

* HttpOnly cookie;
* SameSite protection;
* Secure when using HTTPS;
* server-side revocation;
* session rotation at login;
* idle timeout around 30 minutes;
* absolute timeout around 12 hours.

Exact values may become configuration options.

## Deployment

The baseline deployment model is Docker Compose.

Conceptual services:

```text
web/proxy
api
postgres
```

The exact reverse proxy software remains an implementation choice unless an ADR later fixes it.

Do not require Redis, a message queue, or Kubernetes for v1.

## Network Exposure

Supported v1 access environments:

* localhost;
* trusted LAN clients.

The application does not provide a built-in public-Internet exposure/tunneling system.

Remote access should normally be provided by administrator-controlled infrastructure such as:

* VPN;
* private overlay network;
* trusted HTTPS reverse proxy.

## LAN HTTPS

Preferred behavior:

* localhost may use HTTP for development/local access;
* LAN authentication should use HTTPS where practical;
* administrators may provide their own trusted reverse proxy/certificate;
* a clearly explicit insecure-LAN escape hatch may be allowed where documented.

Security-sensitive cookies must reflect whether HTTPS is actually in use.

## UI Direction

The interface is UniFi-inspired in operational principles.

Important design goals:

* persistent navigation;
* clear router/network health;
* compact operational dashboard;
* dense device inventory;
* drill-down;
* timeline/history views;
* consistent status badges;
* clear severity;
* evidence-focused investigation UI.

Do not copy proprietary UniFi branding or exact layouts.

## Primary Navigation Direction

Initial information architecture:

```text
Dashboard
Devices
Network
Events
Investigations
Settings
```

## Internationalization

Initial UI languages:

* `zh-CN`
* `en`

The browser locale should be the default language signal.

Database timestamps and user-visible timezone formatting are separate concerns.

## Database

PostgreSQL is the persistence baseline.

Expected durable concepts include:

* user;
* session;
* router;
* encrypted router credential;
* router capability;
* device;
* presence event;
* telemetry snapshot;
* audit event;
* investigation;
* investigation evidence.

## Deployment Stack

Confirmed baseline:

* React;
* Vite;
* TypeScript;
* Fastify;
* PostgreSQL;
* Docker Compose;
* SSE where suitable.

## Intentionally Unresolved Implementation Choices

The following are not currently architectural decisions and should not be treated as immutable:

* package manager;
* ORM/query builder;
* React component library;
* CSS strategy;
* icon package;
* reverse proxy implementation;
* test runner;
* exact monorepo tooling;
* exact migration package;
* AI provider SDK;
* charting library.

These may be selected during implementation as long as they respect accepted architecture and security constraints.

## v1 Non-goals

Explicitly outside the initial product scope:

* MSP/multi-tenant administration;
* public signup;
* built-in public Internet tunnel;
* deep packet inspection;
* browsing-history surveillance;
* arbitrary LAN scanning by default;
* firmware upgrades;
* factory reset;
* autonomous AI remediation;
* mandatory cloud AI;
* mandatory local LLM runtime;
* Kubernetes deployment;
* distributed worker infrastructure.
