# Task 0001 — Project Bootstrap

Status: `READY`

Task ID: `0001`

Related plan:

`docs/plans/0001-product-foundation.md`

Related ADRs:

* `docs/adr/0001-backend-mediated-router-access.md`
* `docs/adr/0002-postgresql-persistence.md`
* `docs/adr/0003-application-auth-boundary.md`
* `docs/adr/0004-docker-compose-deployment.md`

## 1. Objective

Create the initial runnable repository foundation for `miwifi-webui` without implementing real router administration or AI functionality.

The bootstrap should establish:

* TypeScript workspace structure;
* React/Vite frontend;
* Fastify backend;
* PostgreSQL Docker Compose service;
* migration foundation;
* health checks;
* linting;
* type checking;
* automated test baseline;
* shared-contract package boundary;
* router-core package boundary.

The implementation must preserve the security and architecture decisions already documented.

## 2. Current state

At task creation, the repository contains planning/governance documentation but no established application stack.

Do not assume existing:

* package manager;
* frontend scaffold;
* backend scaffold;
* database schema;
* migration system;
* test framework.

The repository may contain local tool/runtime directories such as:

```text
.gstack/
.codegraph/
```

These are out of scope and must not be added to source control by this task.

## 3. Scope

This task should create the minimum production-shaped application skeleton needed for future router/security work.

### In scope

* root JavaScript/TypeScript workspace;
* `apps/web`;
* `apps/api`;
* `packages/contracts`;
* `packages/router-core`;
* TypeScript configuration;
* frontend application shell;
* API service;
* database connectivity foundation;
* migration system;
* PostgreSQL Compose service;
* API health endpoint;
* frontend health/basic landing page;
* structured environment configuration;
* lint baseline;
* formatting baseline if desired;
* typecheck baseline;
* test baseline;
* `.gitignore`;
* example environment documentation/file where safe;
* README development instructions once commands actually exist.

### Out of scope

Do not implement:

* real MiWiFi login;
* real router HTTP calls;
* real router credentials;
* capability detection;
* device inventory;
* telemetry polling;
* history ingestion;
* block/unblock;
* other router mutation;
* AI provider;
* AI investigation;
* multi-user management;
* production TLS automation;
* LAN discovery;
* Redis;
* message queue;
* Kubernetes.

## 4. Suggested repository shape

The preferred shape is:

```text
/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── contracts/
│   └── router-core/
├── docs/
├── CONTEXT.md
├── AGENTS.md
├── README.md
├── compose.yaml
├── package.json
├── tsconfig.base.json
└── lockfile
```

Exact support/config filenames may vary according to selected tooling.

## 5. Workspace/package manager

Select one mainstream workspace-capable package manager.

Preference:

`pnpm`

is a reasonable default for a TypeScript monorepo, but this is not an ADR-level requirement.

Whichever tool is selected:

* use one lockfile;
* document its required version if necessary;
* expose root-level scripts;
* avoid duplicating dependencies unnecessarily.

## 6. Root scripts

After bootstrap, root commands should provide a simple interface for developers.

Expected conceptual scripts:

```text
dev
build
test
lint
typecheck
```

If database migration commands are introduced, document them explicitly.

Examples:

```text
db:migrate
db:generate
```

Do not document a command in `README.md` before it actually exists.

## 7. Frontend bootstrap

Create:

```text
apps/web
```

Requirements:

* React;
* Vite;
* TypeScript;
* no SSR requirement;
* no router API access;
* no hardcoded Xiaomi endpoints;
* no router secrets.

The first frontend may contain only:

* application title;
* bootstrap/development status;
* frontend-to-backend health status if useful.

Do not spend this task implementing production visual design.

## 8. Backend bootstrap

Create:

```text
apps/api
```

Requirements:

* Fastify;
* TypeScript;
* structured startup;
* explicit environment parsing/validation;
* health endpoint;
* PostgreSQL connectivity;
* graceful shutdown;
* no router implementation yet.

Suggested health API:

```text
GET /api/health
```

The exact path may vary if API routing conventions are established consistently.

Health response should not leak:

* environment values;
* database credentials;
* secrets;
* internal stack traces.

## 9. Shared contracts

Create:

```text
packages/contracts
```

Purpose:

* API request/response contracts;
* shared validation schemas where appropriate;
* future SSE contracts;
* normalized frontend/backend DTOs.

Do not put router-specific HTTP endpoint implementation here.

The package must remain safe to consume by the frontend.

Therefore it must never expose secret-bearing backend types such as decrypted router credentials.

## 10. Router core boundary

Create:

```text
packages/router-core
```

This task does not implement MiWiFi HTTP calls.

It may define only stable foundational concepts needed to preserve architecture boundaries.

Possible initial types:

```text
RouterCompatibilityStatus
RouterOperationEffect
RouterCapability
```

Suggested compatibility status:

```text
SUPPORTED
PARTIAL
UNKNOWN
INCOMPATIBLE
```

Suggested effects:

```text
READ
WRITE
DISRUPTIVE
DESTRUCTIVE
```

Do not create fake router functionality merely to populate the package.

## 11. PostgreSQL

Provide PostgreSQL through Docker Compose.

Requirements:

* persistent volume;
* database not unnecessarily exposed beyond what local development needs;
* credentials configured through environment variables/secrets rather than embedded application source;
* healthcheck.

Development defaults may be placed in a safe `.env.example` only if they are clearly non-production placeholders.

Do not commit an actual `.env`.

## 12. Migration system

Select a migration mechanism compatible with PostgreSQL and the chosen database-access approach.

The specific ORM/query builder is intentionally unresolved.

Requirements:

* migration files are committed;
* migrations are repeatable;
* schema state is not managed manually;
* future CI can create a clean database from migrations.

The first migration may be empty/minimal if no application tables are needed for bootstrap.

Do not prematurely build the complete final database schema unless required by bootstrap tooling.

## 13. Environment configuration

Backend environment values must be parsed centrally.

Avoid ad-hoc:

```text
process.env.X
```

throughout the application.

Bootstrap should establish one validated configuration boundary.

Expected future categories include:

```text
DATABASE_URL
APP_MASTER_KEY
SESSION settings
AI settings
```

However this task should only require values actually used.

Do not introduce required fake secrets for features not yet implemented.

## 14. Docker Compose

Initial conceptual services:

```text
web
api
postgres
```

A separate reverse proxy may be introduced now only if it materially simplifies the initial deployment.

It is also acceptable for bootstrap to run the Vite development server separately while preparing production container structure later.

Whatever shape is selected must preserve the intended final boundary:

```text
Browser -> application -> backend
```

Do not expose PostgreSQL publicly by default in a production-oriented configuration.

## 15. Container health

Provide meaningful container/application health signals.

At minimum:

* PostgreSQL healthcheck;
* API health endpoint.

The API health route should distinguish application-process availability from secret internal diagnostic information.

A future readiness check may include database readiness.

## 16. Logging

Establish structured logging through Fastify or a compatible logger.

Do not create a custom logging system unless necessary.

Even though router integration is not implemented yet, establish the convention that logs should prefer fields such as:

```text
request_id
route
status
duration
```

over full sensitive payloads.

Do not log request bodies globally.

## 17. Git ignore

Ensure source control excludes at least:

* `node_modules`;
* build output;
* local `.env`;
* local logs;
* coverage artifacts where appropriate;
* PostgreSQL local data if stored under the repo;
* `.codegraph/`;
* `.gstack/`.

Do not accidentally remove developer-owned local runtime directories while updating `.gitignore`.

## 18. Testing baseline

Create a test framework for TypeScript application code.

The exact framework is an implementation choice.

Bootstrap acceptance requires at least:

### API test

Verify health endpoint behavior.

### Frontend test

Verify the initial application renders.

### Shared package test

If foundational domain helpers exist, test at least one stable behavior.

Avoid meaningless tests that only assert constants equal themselves.

## 19. Type checking

Provide a root command that type-checks all workspace packages.

No TypeScript errors should remain at task completion.

Do not use broad `any` or disable strictness solely to make bootstrap pass.

## 20. Linting

Provide root lint behavior covering application/source packages.

Do not lint generated build output or third-party dependencies.

The specific linter configuration may be selected during implementation.

## 21. Build

Provide a root build command.

Successful build should include:

* frontend production build;
* backend compile/bundle as appropriate;
* shared package compilation where required.

## 22. Development workflow

README must be updated after bootstrap to document the actual workflow.

Expected minimum sections:

```text
Prerequisites
Install
Environment
Start PostgreSQL
Run migrations
Run development servers
Test
Lint
Typecheck
Build
```

Only document verified commands.

## 23. Security requirements

This bootstrap task must not weaken later security work.

### Required

* no secrets committed;
* no router credentials;
* no `stok`;
* no arbitrary URL fetch endpoint;
* no global request-body logging;
* no database credentials embedded in source;
* no frontend access to backend-only secret types.

### Forbidden shortcuts

Do not add temporary endpoints such as:

```text
GET /fetch?url=...
POST /router/raw
```

for future convenience.

Do not embed router password fields into shared browser-visible state.

## 24. Architecture requirements

The bootstrap must make the intended dependency direction natural.

Preferred conceptual direction:

```text
web
 |
 v
contracts

api
 | \
 |  \
 v   v
contracts
router-core
```

Avoid:

```text
web -> router-core implementation secrets
```

The router transport implementation will later live in a backend-safe package/layer.

## 25. Database schema restraint

Do not prematurely define every final table in this task.

It is acceptable to create only infrastructure/migration foundations.

If an initial user/health table is needed for technical reasons, keep it minimal and explain why.

Full entities should be introduced by dedicated tasks when their invariants and tests are ready.

## 26. Success criteria

Task is complete only when all applicable criteria below pass.

### Repository

* workspace structure exists;
* dependencies install cleanly;
* one lockfile exists;
* `.gitignore` protects local/generated data.

### Frontend

* React/Vite app starts;
* production frontend build succeeds;
* no direct Xiaomi router request code exists.

### Backend

* Fastify starts;
* health endpoint responds;
* backend shuts down gracefully;
* database connectivity path exists.

### PostgreSQL

* Compose starts PostgreSQL;
* healthcheck works;
* data is persistent;
* migration tool can connect.

### Quality

* root test command passes;
* root lint command passes;
* root typecheck command passes;
* root build command passes.

### Documentation

* README contains real, verified setup commands;
* no imaginary development commands remain;
* task completion record is updated.

### Security

* no real credentials;
* no global request-body logging;
* no arbitrary URL proxy;
* `.gstack/` and `.codegraph/` are not committed.

## 27. Recommended verification

The exact commands depend on the selected package manager.

Equivalent checks should include:

```text
install dependencies
start PostgreSQL
run migrations
run tests
run lint
run typecheck
run build
start API
verify health endpoint
start web
verify initial page
```

If using pnpm, the final project may expose commands resembling:

```bash
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm dev
```

These examples must not be copied into the root README unless they actually match the implemented scripts.

## 28. Expected changed areas

Likely:

```text
package.json
lockfile
tsconfig*
.gitignore
compose.yaml

apps/web/**
apps/api/**

packages/contracts/**
packages/router-core/**

README.md
docs/tasks/0001-project-bootstrap.md
```

Do not modify unrelated local tool state.

## 29. Completion record

Complete this section only after implementation.

### Result

Status:

`NOT YET EXECUTED`

### Implementation summary

Pending.

### Verification

Pending.

### Deviations from task

Pending.

### Follow-up work

Expected next task:

MiWifiAdapter / compatibility-probe foundation.
