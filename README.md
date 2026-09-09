# miwifi-webui

Modern, self-hosted web administration, observability, device tracking, telemetry history, and AI-assisted investigation interface for Xiaomi / Redmi routers exposing compatible MiWiFi Web APIs.

Inspired by the operational experience of modern network management platforms (such as UniFi), `miwifi-webui` is an independent, security-first implementation designed specifically around Xiaomi routers and the MiWiFi API ecosystem.

---

## ✨ Key Features

- 📊 **UniFi-Inspired Operational Dashboard**: Customizable widget grid with live WAN upload/download rates, CPU load, memory utilization, router temperature, and active device counters.
- 📱 **Device Inventory & Presence Timeline**: Real-time tracking of connected clients, first/last seen timestamps, IP/MAC mappings, and event-based online/offline history.
- 🚦 **Per-Device WAN Traffic Tracking**: Monitor and rank observed device traffic deltas over configurable time windows.
- 🛡️ **Safe & Controlled Operations**: Internet access control (block/unblock devices) protected by strict backend effect classifications (`READ`, `WRITE`, `DISRUPTIVE`, `DESTRUCTIVE`).
- 🔍 **Privacy-First AI Investigation**: Optional, read-only AI diagnosis for network incidents. External LLM providers receive 100% pseudonymized context (MAC/IP/device names are aliased locally; the translation legend never leaves your server).
- 🔒 **Security & Isolation by Design**: 
  - The browser **never** communicates directly with the Xiaomi router API.
  - Router passwords and `stok` session tokens are never leaked to the client or log files.
  - Passwords hashed with Argon2id; router credentials encrypted at rest using AES-256-GCM envelope encryption.
- 🌐 **Capability-Driven Compatibility**: No brittle model whitelists. Automatically probes router endpoints and adapts gracefully (`SUPPORTED`, `PARTIAL`, `UNKNOWN`, `INCOMPATIBLE`).
- 🇨🇳 / 🇬🇧 **Bilingual Interface**: Built-in support for Simplified Chinese (`zh-CN`) and English (`en`), with automatic browser locale detection.

## Preview

![miwifi-webui dashboard](docs/media/miwifi-webui-dashboard.png)

[Watch the 18-second product tour](docs/media/miwifi-webui-overview.mp4)

---

## ⚡ Quick Start

You can run `miwifi-webui` in minutes using **Docker Compose** (recommended for deployment) or via **pnpm** (for local development).

### Method 1: Docker Compose (Recommended)

#### 1. Prepare `compose.yaml`

Create a file named `compose.yaml` (or clone the repository):

```yaml
name: miwifi-webui

services:
  postgres:
    image: postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73
    container_name: miwifi-webui-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-miwifi}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-miwifi-secret}
      POSTGRES_DB: ${POSTGRES_DB:-miwifi}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: [ "CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-miwifi} -d ${POSTGRES_DB:-miwifi}" ]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  api:
    image: highwall777/miwifi-webui-api:latest
    container_name: miwifi-webui-api
    restart: unless-stopped
    healthcheck:
      test: [ "CMD", "node", "-e", "fetch('http://127.0.0.1:3001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" ]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
    env_file:
      - path: .env
        required: false
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-miwifi}:${POSTGRES_PASSWORD:-miwifi-secret}@postgres:5432/${POSTGRES_DB:-miwifi}
      APP_MASTER_KEY: ${APP_MASTER_KEY:-c29tZS1kZWZhdWx0LTMyLWJ5dGUtbWFzdGVyLWtleSE=}
      API_PORT: 3001
      API_HOST: 0.0.0.0
      AI_PROVIDER_MODE: ${AI_PROVIDER_MODE:-}
      AI_PROVIDER_BASE_URL: ${AI_PROVIDER_BASE_URL:-}
      AI_PROVIDER_MODEL: ${AI_PROVIDER_MODEL:-}
      AI_PROVIDER_API_KEY: ${AI_PROVIDER_API_KEY:-}
      RETENTION_TELEMETRY_DAYS: ${RETENTION_TELEMETRY_DAYS:-90}
      RETENTION_PRESENCE_DAYS: ${RETENTION_PRESENCE_DAYS:-365}
      RETENTION_AUDIT_DAYS: ${RETENTION_AUDIT_DAYS:-365}
      RETENTION_INVESTIGATION_DAYS: ${RETENTION_INVESTIGATION_DAYS:-30}
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "${API_PORT:-3001}:3001"

  web:
    image: highwall777/miwifi-webui-web:latest
    container_name: miwifi-webui-web
    restart: unless-stopped
    depends_on:
      api:
        condition: service_healthy
    ports:
      - "${WEB_PORT:-5173}:8080"

volumes:
  postgres-data:
```

#### 2. Start the Service

Directly start the stack:

```bash
docker compose up -d
```

#### 3. Create Initial Administrator Account

For security, first-run bootstrap creates an administrator account. Run:

```bash
docker compose exec -e ADMIN_PASSWORD="YourSecurePassword123!" api node dist/cli/admin.js create admin
```

> **Requirements**:
> - `ADMIN_PASSWORD` must be at least 10 characters long.
> - Username must be 3–32 characters (`[a-zA-Z0-9_.-]`).

#### 4. Access Web UI and Log In

Open **http://localhost:5173** in your browser and log in with your newly created admin credentials.

#### 5. Onboard Your Router

On first use, you need to set up/create your Xiaomi router:
1. Navigate to **Settings** -> **Router Configuration**.
2. Enter your **Router IP** (e.g. `192.168.31.1`).
3. Set **Username** to `admin` (or fill in `admin`).
4. Enter the **Password** used when logging into `https://miwifi.com` (your router web admin password).
5. Click **Probe & Save**. The backend will verify compatibility, encrypt credentials at rest, and begin background telemetry polling.

#### 6. AI Investigation Feature Setup (Optional)

If you need the **AI Investigation** feature, configure the following environment variables in your environment or `.env` file before running `docker compose up -d`:

- `AI_PROVIDER_MODE`: Set to `external` (cloud LLMs) or `local` (self-hosted Ollama/vLLM).
- `AI_PROVIDER_BASE_URL`: OpenAI-compatible API base URL (e.g. `https://api.openai.com/v1`).
- `AI_PROVIDER_MODEL`: Model identifier (e.g. `gpt-4o` or `deepseek-chat`).
- `AI_PROVIDER_API_KEY`: API key for your AI provider.

Example `.env` snippet:

```env
AI_PROVIDER_MODE=external
AI_PROVIDER_BASE_URL=https://api.openai.com/v1
AI_PROVIDER_MODEL=gpt-4o
AI_PROVIDER_API_KEY=your_api_key_here
```

---

### Method 2: Local Development Setup (pnpm)

#### Prerequisites

- **Node.js**: >= 22
- **pnpm**: 11 (enable via `corepack enable`)
- **Docker**: For running the local PostgreSQL container

#### 1. Install Dependencies

```bash
corepack enable
pnpm install
```

#### 2. Configure Environment

```bash
cp .env.example .env
```

Generate and set `APP_MASTER_KEY` in `.env`:

```bash
openssl rand -base64 32
```

#### 3. Start Database and Run Migrations

```bash
# Start PostgreSQL container
docker compose up -d postgres

# Run database migrations
pnpm db:migrate
```

#### 4. Start Development Servers

```bash
pnpm dev
```

This concurrently starts:
- **Web (Vite)**: http://localhost:5173 (proxies `/api` to the backend)
- **API (Fastify with tsx watch)**: http://127.0.0.1:3001

#### 5. Create Initial Administrator

```bash
ADMIN_PASSWORD="YourSecurePassword123!" pnpm admin:create admin
```

Open http://localhost:5173 to access the application.

---

## 🏗️ Architecture

`miwifi-webui` enforces a strict backend-mediated trust boundary:

```text
┌─────────────────────────────────────────────────────────────┐
│                       Browser Client                        │
│                   (React 19 + TypeScript)                   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / SSE (Cookie Auth)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     Web / Reverse Proxy                     │
│               (Nginx / Traefik / Caddy / Vite)              │
└──────────────────────────────┬──────────────────────────────┘
                               │ /api proxy
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Application Backend (Fastify)               │
│                                                             │
│  • Session Auth (Argon2id)   • Audit Event Writer           │
│  • AES-256-GCM Envelope      • Polling Scheduler            │
│  • Realtime EventBridge      • Privacy-Preserving AI Engine │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│     PostgreSQL Database     │ │        MiWifiAdapter        │
│                             │ │                             │
│ • Encrypted Credentials     │ │ • Login & Stok Management   │
│ • Device Presence History   │ │ • Capability Probing        │
│ • Telemetry Snapshots       │ │ • Target Host Validation    │
│ • Audit Log & AI Sessions   │ │ • Effect Class Guardrails   │
└─────────────────────────────┘ └──────────────┬──────────────┘
                                               │ HTTP (LuCI API)
                                               ▼
                                ┌─────────────────────────────┐
                                │     Xiaomi/Redmi Router     │
                                │       (MiWiFi Web API)      │
                                └─────────────────────────────┘
```

### Trust Boundary Invariants

1. **Zero Browser-to-Router Traffic**: The client never communicates directly with the Xiaomi router.
2. **Ephemeral Session Tokens (`stok`)**: The router `stok` token lives only in backend memory and is renewed automatically. It is never persisted in the database, logged, or sent to the frontend.
3. **No Arbitrary Proxying**: The backend does not act as an open proxy or SSRF gateway. All target addresses are validated against private/local network policies (RFC 1918, link-local, loopback).

---

## 📡 Router Compatibility

Compatibility is **capability-driven**, not based on a hardcoded model whitelist:

| Status | Meaning |
| --- | --- |
| `SUPPORTED` | Router responds cleanly to auth, status, device list, and telemetry endpoints. |
| `PARTIAL` | Router responds to core endpoints, but some optional data points (e.g. detailed WAN stats or hardware metrics) are missing. |
| `UNKNOWN` | Model identifier not recognized, but standard MiWiFi endpoints respond and pass capability probing. |
| `INCOMPATIBLE` | Router does not expose compatible LuCI / MiWiFi Web APIs or authentication fails fundamentally. |

Upstream API Behavioral Reference: [RACErace/MiWiFi-API](https://github.com/RACErace/MiWiFi-API).

---

## 🔒 Security Model

- **Credential Separation**: Application administrator credentials and router administration credentials are completely independent.
- **Envelope Encryption**: Router passwords stored in PostgreSQL are sealed using AES-256-GCM under `APP_MASTER_KEY`. If the key is omitted or corrupted, the database fails closed.
- **Session Security**: Server-side session tracking with SHA-256 token indexing, sliding idle timeouts, absolute expiry, rotation on login, and `HttpOnly` / `SameSite=Lax` cookies.
- **Timing Attack Resistance**: Constant-time comparison for login verification prevents username/password timing side-channels.
- **Sanitized Audit Log**: Administrative and security events are logged with allowlisted metadata; passwords, tokens, and authorization headers are strictly excluded.
- **Read-Only AI**: The AI investigation assistant has only read-only diagnostic tools. It cannot block devices, reboot the router, alter Wi-Fi passwords, or change network configurations.

---

## 🤖 Privacy-Preserving AI Investigation

AI investigation is **disabled by default** and requires explicit administrator configuration:

1. **Local Mode (`AI_PROVIDER_MODE=local`)**: Use local LLMs (e.g., Ollama, vLLM, LM Studio) with an OpenAI-compatible endpoint. Device identifiers pass through locally.
2. **External Mode (`AI_PROVIDER_MODE=external`)**: Use cloud providers (OpenAI, DeepSeek, Anthropic via gateway, etc.). 
   - All MAC addresses, IP addresses, and custom device names are replaced with deterministic aliases (`device_1`, `192.168.X.1`, etc.) **before** leaving your server.
   - The alias-to-real mapping legend is kept purely in your local PostgreSQL database to render readable findings in the UI.
   - External providers never receive your real network topology or device identities.

---

## ⚙️ Environment Variables Reference

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string (`postgres://user:pass@host:5432/db`) |
| `APP_MASTER_KEY` | For Router | - | 32-byte base64 key for sealing router credentials (`openssl rand -base64 32`) |
| `API_PORT` | No | `3001` | Fastify backend listening port |
| `API_HOST` | No | `0.0.0.0` | Backend bind address (`0.0.0.0` in containers, `127.0.0.1` locally) |
| `WEB_PORT` | No | `80` (Docker) / `5173` (Dev) | Port exposed by the web UI |
| `TRUST_PROXY` | Behind Proxy | `false` | Comma-separated CIDR/IP list of trusted reverse proxies (e.g. `172.16.0.0/12`) |
| `AI_PROVIDER_MODE` | No | - | `local`, `external`, or unset (disabled) |
| `AI_PROVIDER_BASE_URL` | For AI | - | OpenAI-compatible API base URL (e.g. `https://api.openai.com/v1`) |
| `AI_PROVIDER_MODEL` | For AI | - | Model identifier (e.g. `gpt-4o`, `deepseek-chat`) |
| `AI_PROVIDER_API_KEY` | For AI | - | API key for the AI provider |
| `RETENTION_TELEMETRY_DAYS` | No | `90` | Telemetry snapshot retention period (days) |
| `RETENTION_PRESENCE_DAYS` | No | `365` | Device presence event retention period (days) |
| `RETENTION_AUDIT_DAYS` | No | `365` | Security/audit event retention period (days) |
| `RETENTION_INVESTIGATION_DAYS` | No | `30` | AI investigation session retention period (days) |

---

## 🛠️ CLI Operations & Password Recovery

The application includes an administrative CLI (`apps/api/src/cli/admin.ts`):

```bash
# Create an administrator
docker compose exec -e ADMIN_PASSWORD="NewPassword123!" api node dist/cli/admin.js create <username>
# Or in local development:
ADMIN_PASSWORD="NewPassword123!" pnpm admin:create <username>

# Reset an administrator's password
docker compose exec -e ADMIN_PASSWORD="NewPassword123!" api node dist/cli/admin.js reset-password <username>
# Or in local development:
ADMIN_PASSWORD="NewPassword123!" pnpm admin:reset-password <username>
```

> For full disaster recovery and backup guidelines, see [docs/backup-restore.md](docs/backup-restore.md).

---

## 🧪 Testing & Code Quality

The repository includes a comprehensive test suite (100+ tests) with zero runtime router dependencies, using deterministic fixtures and sentinel leak assertions:

```bash
# Run unit & integration tests
pnpm test

# Run TypeScript typechecks
pnpm typecheck

# Run ESLint checks
pnpm lint

# Production build (Web + API)
pnpm build
```

---

## 📚 Project Documentation

- [Documentation Index](docs/README.md)
- [Architecture Decision Records (ADRs)](docs/adr/README.md)
- [Product Foundation Plan](docs/plans/0001-product-foundation.md)
- [Domain Terminology & Context](CONTEXT.md)
- [Backup & Restore Guide](docs/backup-restore.md)

---

## ⚠️ Disclaimer & License

`miwifi-webui` is an independent open-source community project. It is not affiliated with, endorsed by, or associated with Xiaomi Inc. or any of its subsidiaries. "Xiaomi", "Redmi", and "MiWiFi" are trademarks of their respective owners.

Project licensing is to be finalized. See repository terms for details.
