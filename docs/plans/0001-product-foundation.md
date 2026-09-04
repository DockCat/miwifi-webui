# Product Foundation Plan

Status: `ACCEPTED`

Plan ID: `0001`

Project: `miwifi-webui`

Original planning task: `c2c_9561`

## 1. Purpose

This document captures the accepted product, architecture, security, data, AI, compatibility, UI, deployment, and testing direction for the first major development phase of `miwifi-webui`.

It intentionally describes shared product foundations rather than detailed implementation choices.

The plan should be treated as the baseline for implementation tasks until superseded.

## 2. Product vision

`miwifi-webui` should provide a modern self-hosted administration and investigation experience for Xiaomi / Redmi routers exposing compatible MiWiFi Web APIs.

The intended experience combines:

* router visibility;
* network/device inventory;
* operational history;
* administrative audit;
* conservative router control;
* evidence-backed AI-assisted investigation.

The UI may draw inspiration from the operational clarity of products such as UniFi while remaining an independent implementation.

## 3. Primary audience

The first version targets:

* home network administrators;
* prosumers;
* homelab operators.

v1 assumes:

* one self-hosted installation;
* one administrative trust domain;
* one primary application administrator;
* one primary router/Mesh experience.

The internal data model should avoid unnecessary assumptions that would make future multiple-router support prohibitively expensive.

## 4. Explicit non-goals

v1 does not aim to provide:

* MSP multi-tenancy;
* customer/tenant isolation;
* public self-registration;
* built-in public Internet tunneling;
* a cloud-hosted control plane;
* packet inspection;
* browsing-history collection;
* firmware management;
* factory reset;
* autonomous AI remediation;
* arbitrary LAN-wide discovery scanning;
* Kubernetes;
* distributed microservices;
* Redis/message-queue infrastructure unless later justified.

## 5. High-level architecture

Accepted topology:

```text
Browser
   |
   v
Web / reverse proxy
   |
   v
Fastify backend
   |
   +------------------+
   |                  |
   v                  v
PostgreSQL       MiWifiAdapter
                       |
                       v
                 Xiaomi Router
                 local MiWiFi API
```

## 6. Trust boundary

The backend is the router trust boundary.

The browser must never directly communicate with the Xiaomi router API.

The frontend must not receive:

* Xiaomi administration password;
* MiWiFi `stok`;
* internal router authorization material.

The backend owns:

* router authentication;
* session renewal;
* credential encryption/decryption;
* router request construction;
* response normalization;
* compatibility probing;
* polling;
* mutation execution;
* router-side error handling.

## 7. Upstream MiWiFi reference

The project uses:

[https://github.com/RACErace/MiWiFi-API](https://github.com/RACErace/MiWiFi-API)

as behavioral/reference documentation.

The application should not assume that upstream is a complete, versioned, tested SDK.

The internal implementation must provide its own typed `MiWifiAdapter`.

Reasons:

* upstream primarily documents HTTP behavior;
* endpoint availability may differ by hardware and firmware;
* some documented operations may be untested;
* HTTP method does not reliably describe operation safety;
* application behavior must remain testable through fixtures.

## 8. Router compatibility strategy

The product goal is broad compatibility with routers that expose compatible MiWiFi APIs.

This must not be represented as a claim that:

> every API works on every Xiaomi router.

Compatibility should be capability-driven.

### 8.1 Onboarding flow

Conceptual onboarding:

```text
Router host/address
        |
        v
Target validation
        |
        v
Safe init/basic probe
        |
        v
Read hardware/model/firmware information
        |
        v
Authenticate
        |
        v
Run safe read-only capability probes
        |
        v
Persist capability profile
```

### 8.2 Unknown models

An unknown router model should be allowed to proceed through capability detection.

Unknown model name alone is not an incompatibility condition.

### 8.3 Compatibility states

The application should expose:

* `SUPPORTED`
* `PARTIAL`
* `UNKNOWN`
* `INCOMPATIBLE`

### 8.4 Capability examples

Potential capabilities include:

* router information;
* health metrics;
* device inventory;
* device traffic;
* Wi-Fi state;
* Mesh information;
* 160 MHz information;
* device Internet access control.

Features should be enabled based on discovered capability rather than model-name assumptions.

## 9. Router target safety

The backend must not become an arbitrary server-side HTTP proxy.

Onboarding should accept a router address/host rather than an unrestricted URL.

Initial behavior should favor explicitly permitted local/private targets.

The backend should:

* reject unsupported schemes;
* construct endpoint paths internally;
* validate resolved targets;
* avoid unsafe redirect behavior;
* prevent obvious public-Internet/SSRF abuse.

The exact hostname and IPv6 rules may be refined during implementation, but the security boundary is mandatory.

## 10. Product access scope

The application is intended for:

* localhost access;
* trusted LAN access.

The product should not build its own public Internet exposure service.

Remote access should be left to administrator-controlled infrastructure such as:

* VPN;
* private overlay networking;
* trusted HTTPS reverse proxy.

## 11. HTTPS direction

For local development and direct localhost access, HTTP may be acceptable.

For authenticated LAN use, HTTPS is preferred and should be the secure default where practical.

Possible deployment paths include:

* administrator-provided reverse proxy/certificate;
* trusted internal CA;
* normal domain/TLS setup.

If insecure LAN HTTP is supported, it should be an explicit opt-in rather than a silent security downgrade.

## 12. Technology baseline

Accepted high-level stack:

### Frontend

* React
* Vite
* TypeScript

### Backend

* Fastify
* TypeScript

### Database

* PostgreSQL

### Deployment

* Docker Compose

### Realtime

* Server-Sent Events where suitable

No current requirement exists for:

* SSR;
* serverless execution;
* WebSockets;
* Redis;
* message queue;
* Kubernetes.

Those technologies may only be introduced later for demonstrated requirements.

## 13. Deployment topology

Conceptual Docker Compose deployment:

```text
web/proxy
├── static frontend
└── /api proxy

api
├── Fastify
├── authentication
├── MiWifiAdapter
├── polling
├── history
├── audit
├── SSE
└── AI investigation

postgres
└── persistent volume
```

Background polling/jobs may initially execute inside the backend service.

A separate worker is not required for v1.

## 14. Application authentication

v1 begins as a single-user application.

Single-user means one initial administrator, not "no authentication".

Expected direction:

1. application has no users;
2. first-run bootstrap is available under a restricted local setup path;
3. administrator creates the initial application password;
4. bootstrap is disabled after successful creation;
5. normal sessions are required for later access.

No public signup.

No email-registration dependency.

No application password reuse from the Xiaomi router.

## 15. Password and session security

Application passwords should use Argon2id.

Sessions should be server-side.

Expected protections:

* HttpOnly cookies;
* SameSite protection;
* Secure cookies when HTTPS is active;
* session rotation on authentication;
* logout revocation;
* password-change revocation;
* idle expiration;
* absolute expiration;
* CSRF/origin protections for mutations.

Initial default direction:

* approximately 30-minute idle timeout;
* approximately 12-hour absolute timeout.

Exact values should be configurable later rather than hard architectural constants.

## 16. Router credential storage

The application must be able to renew MiWiFi authentication without requiring the administrator to manually re-enter the router password every time a session expires.

Therefore router credentials may be persisted.

Requirements:

* encrypt router credentials at application level;
* store encrypted ciphertext in PostgreSQL;
* keep the application master key outside PostgreSQL;
* never expose the decrypted password to the frontend;
* never log the password;
* never put the password in audit metadata.

Conceptual model:

```text
APP_MASTER_KEY
      |
      v
application encryption
      |
      v
encrypted router credential
      |
      v
PostgreSQL
```

The exact cryptographic library and envelope format may be selected during implementation subject to security review.

## 17. MiWiFi session token

MiWiFi `stok` is sensitive router session material.

Rules:

* backend only;
* never returned in public API DTOs;
* never written to normal logs;
* never placed in audit metadata;
* never treated as user-facing state.

When authentication expires, the backend should renew the router session using the encrypted router credential.

## 18. Data model direction

PostgreSQL is required because the product maintains durable history and security records.

Initial entity direction:

```text
app_user
app_session

router
router_credential
router_capability

device
device_presence_event

telemetry_snapshot

audit_event

investigation
investigation_evidence
```

The final schema may refine names/normalization, but these domain boundaries should remain visible.

## 19. Entity identity

Use synthetic application identifiers.

### Router

Do not use:

* IP address;
* hostname;
* model name

as the permanent router primary key.

These may change.

### Device

Do not treat MAC address as the only permanent logical identity.

MAC remains important network observation data, but devices may use randomized/private addresses.

The exact device identity-reconciliation strategy can evolve separately.

## 20. Historical-data categories

The application maintains three primary historical categories.

### 20.1 Audit

Application/security history.

Examples:

* login success/failure;
* logout;
* router onboarding;
* router mutation;
* administrative setting change;
* AI investigation;
* export/purge action.

### 20.2 Telemetry

Sampled operational measurements.

Examples:

* router health;
* WAN state;
* Wi-Fi state;
* traffic;
* active client count;
* Mesh state.

### 20.3 Device Presence

Event-based device connectivity history.

Examples:

* first seen;
* online;
* offline.

These categories must remain logically distinct.

## 21. Polling direction

Initial defaults:

```text
Current router state      approximately 15 seconds
Device inventory          approximately 30 seconds
Persisted telemetry       approximately 60 seconds
Device presence           on transition + reconciliation
Audit                     immediately when event occurs
```

UI polling/rendering must not define persistence frequency.

A user repeatedly refreshing the dashboard must not produce excess telemetry history.

## 22. Retention

Initial defaults:

### Telemetry

Approximately 90 days at the primary high-resolution interval.

### Presence

Longer-lived compact event history.

### Audit

Approximately one year.

### Investigation content

Approximately 30 days.

Retention values should eventually be configurable.

Retention jobs should be explicit application behavior.

## 23. Audit requirements

Audit is logically append-only during normal operation.

Normal application features should not casually update/delete historical audit rows.

Audit event direction:

```text
timestamp
actor
action
target_type
target_id
router_id
outcome
request_correlation_id
safe_metadata
```

Metadata must use explicit safe fields.

Never store:

* router password;
* `stok`;
* master key;
* AI API key;
* session cookie;
* arbitrary raw request body.

## 24. Router mutation model

The product is observability-first.

Router HTTP method is not a safe indicator of operation effect.

Every router operation should declare one of:

* `READ`
* `WRITE`
* `DISRUPTIVE`
* `DESTRUCTIVE`

## 25. Initial mutation scope

Initial router mutation should be extremely limited.

First candidates:

* block device Internet access;
* unblock/restore device Internet access.

The application should verify support before presenting the action.

Mutation flow:

```text
User confirmation
       |
       v
Backend authentication/authorization
       |
       v
Audit attempt
       |
       v
Router mutation
       |
       v
Read-back verification
       |
       v
Audit success/failure
       |
       v
UI state update
```

## 26. Deferred destructive/disruptive operations

Do not implement in the initial mutation milestone:

* router reboot;
* firmware update;
* factory reset;
* Mesh removal/addition;
* country-code changes;
* broad Wi-Fi reconfiguration.

Such capabilities require separate review and tasks.

## 27. AI product position

AI is optional.

The product must remain fully useful when AI is disabled.

AI serves as an investigation interface over normalized application data.

It is not the application's primary control plane.

## 28. AI default state

Default:

```text
AI = disabled
External data egress = disabled
```

The administrator must explicitly configure an AI provider.

## 29. AI provider direction

The architecture should allow provider abstraction.

Potential modes:

* disabled;
* local provider;
* external provider.

A local provider may eventually be OpenAI-compatible or use another supported API.

The main Docker Compose deployment should not require a large local model runtime.

A local model may be provided later through an optional profile or separate integration.

## 30. AI permissions

v1 AI tools are read-only.

Allowed tool categories may include:

* router health;
* device state;
* presence history;
* telemetry history;
* application/router events;
* evidence lookup.

The AI must not initially receive tools for:

* block/unblock;
* reboot;
* Wi-Fi changes;
* reset;
* other router mutations.

## 31. AI tool safety

Agent tools should have:

* explicit input schema;
* explicit output schema;
* bounded time range;
* bounded result counts;
* no credential fields;
* audit visibility.

Do not provide the model unrestricted SQL or arbitrary backend network access.

## 32. Evidence-backed investigation

AI conclusions should be traceable to local application records.

Example:

```text
Finding:
Device X appears to have disconnected at 14:32.

Evidence:
- presence_event #813
- telemetry_snapshot #29102
- router_event #144
```

Evidence should remain inspectable without trusting the AI explanation.

## 33. AI privacy

External AI contexts should be minimized by default.

Prefer:

```text
router_01
device_01
```

over unnecessary raw identifiers.

Never send AI providers:

* router passwords;
* `stok`;
* Wi-Fi passwords;
* application master keys;
* API credentials.

Sensitive identifiers such as:

* MAC;
* IP;
* serial;
* raw device name

should require an explicit policy/use need before external transmission.

## 34. AI history

Separate:

* investigation content;
* long-term application audit.

Long-lived audit may record:

* who started the investigation;
* when;
* provider/model;
* tools used;
* data categories accessed;
* result status.

Do not automatically retain unlimited raw prompts/provider payloads forever.

Initial investigation-content retention target:

approximately 30 days.

## 35. UI direction

The UI should be operationally inspired by modern network controllers such as UniFi without copying proprietary brand assets or exact designs.

Desired qualities:

* persistent navigation;
* high-information dashboard;
* device table;
* clear online/offline state;
* status badges;
* history timelines;
* drill-down;
* investigation/evidence UI;
* responsive incident checking.

Status must not be communicated by color alone.

Use:

* text;
* icon;
* badge/shape

where appropriate.

## 36. Initial navigation

Proposed v1 information architecture:

```text
Dashboard
Devices
Network
Events
Investigations
Settings
```

## 37. Device table direction

Initial device table fields may include:

```text
Name
IP
MAC
Connection
Online/Offline
Traffic
First Seen
Last Seen
Internet Access
```

Availability depends on router capabilities.

## 38. Device detail direction

Potential sections:

```text
Overview
Presence Timeline
Traffic History
Events
Investigation Evidence
```

## 39. Internationalization

Build i18n foundations from the beginning.

Initial languages:

* Simplified Chinese;
* English.

Default selection:

browser locale.

The application should not expose untranslated raw router enums as final UI labels.

## 40. Time handling

Persist timestamps in a consistent backend/database representation.

Render date/time according to application/user locale and local timezone.

Do not encode Singapore time, router time, or browser time directly into durable event semantics.

## 41. Testing strategy

Router support must not require a real router for normal test execution.

### Unit tests

Cover:

* target validation;
* secret redaction;
* capability parsing;
* operation-effect classification;
* presence transitions;
* retention calculations.

### Router adapter contract tests

Cover:

* successful login;
* authentication failure;
* token/session expiry;
* malformed responses;
* unknown router;
* partial support;
* unsupported capability;
* offline router.

### API integration tests

Cover:

* PostgreSQL;
* bootstrap;
* authentication;
* sessions;
* CSRF/origin protections;
* audit behavior;
* history queries.

### Frontend tests

Cover:

* login;
* loading/error states;
* router compatibility state;
* dashboard state;
* device listing;
* mutation confirmation.

### End-to-end tests

Use a mock router.

Potential flow:

```text
bootstrap admin
      |
      v
login
      |
      v
onboard mock router
      |
      v
detect capabilities
      |
      v
collect history
      |
      v
run investigation
      |
      v
block/unblock via mock
```

## 42. Live-router testing

Live router integration tests are opt-in.

Default test commands must never:

* require a real router;
* require real router credentials;
* perform real mutations.

Mutating live-router tests need an additional explicit opt-in safety gate.

## 43. Secret-leak regression testing

Tests should detect accidental appearance of sentinel secrets in:

* API responses;
* logs;
* audit metadata;
* error messages;
* snapshots.

Secret classes include:

* router password;
* `stok`;
* `APP_MASTER_KEY`;
* AI API key.

## 44. Delivery roadmap

### Phase 0 — Documentation and architecture baseline

Deliver:

* README;
* AGENTS;
* CONTEXT;
* product plan;
* task system;
* accepted ADRs.

### Phase 1 — Project bootstrap

Deliver:

* repository workspace structure;
* frontend skeleton;
* API skeleton;
* PostgreSQL Compose service;
* migration foundation;
* healthchecks;
* test/lint/typecheck baseline.

### Phase 2 — Security/auth foundation

Deliver:

* bootstrap administrator;
* password hashing;
* session management;
* router credential encryption;
* target validation;
* safe structured logging.

### Phase 3 — MiWifiAdapter foundation

Deliver:

* typed adapter;
* fixture transport/mock;
* compatibility probe;
* login/session lifecycle;
* normalized router info;
* capability profile.

### Phase 4 — Observability

Deliver:

* router state polling;
* device inventory;
* telemetry persistence;
* presence events;
* audit events;
* SSE updates.

### Phase 5 — Operational UI

Deliver:

* dashboard;
* devices;
* network health;
* event/history views;
* router compatibility UI.

### Phase 6 — Limited administration

Deliver:

* device Internet block/unblock;
* confirmation;
* audit;
* read-back verification.

### Phase 7 — AI investigation

Deliver:

* provider abstraction;
* read-only tools;
* investigation records;
* evidence;
* privacy controls;
* external-provider opt-in.

### Phase 8 — Hardening

Deliver:

* retention;
* backup/restore documentation;
* extended compatibility fixtures;
* failure-mode tests;
* security regression tests;
* deployment hardening.

## 45. Primary risks

### Router API variation

Mitigation:

* runtime capabilities;
* partial support;
* fixtures;
* safe parsing.

### Sensitive router credentials

Mitigation:

* backend boundary;
* encryption at rest;
* secret redaction;
* no frontend exposure.

### SSRF/local-network abuse

Mitigation:

* host/address input;
* local target validation;
* adapter-generated paths;
* redirect controls.

### Data growth

Mitigation:

* separate telemetry/presence/audit;
* retention;
* compact presence events;
* configurable polling.

### AI information leakage

Mitigation:

* disabled by default;
* explicit provider setup;
* pseudonymization;
* controlled tools;
* data-category policy.

### AI overreach

Mitigation:

* read-only v1;
* no router mutation tools;
* evidence-backed output.

## 46. Definition of product-foundation success

The product foundation is considered implemented correctly when later code:

* preserves the backend/router trust boundary;
* treats PostgreSQL as durable storage;
* supports capability-based router behavior;
* does not expose router secrets;
* distinguishes telemetry/presence/audit;
* keeps AI optional and read-only;
* supports fixture-based router testing;
* stays deployable through a simple self-hosted Docker Compose topology.

## 47. Decisions intentionally left reversible

The plan does not currently fix:

* package manager;
* ORM;
* query builder;
* React UI kit;
* CSS solution;
* chart library;
* icon library;
* reverse proxy vendor;
* unit test framework;
* AI SDK;
* logging package.

These are implementation choices and should be selected based on fit rather than prematurely promoted to architecture decisions.
