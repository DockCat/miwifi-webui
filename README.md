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

---

## ⚡ Quick Start

You can run `miwifi-webui` in minutes using **Docker Compose** (recommended for deployment) or via **pnpm** (for local development).

### Method 1: Docker Compose (Recommended)

#### 1. Clone the repository

```bash
git clone https://github.com/DockCat/miwifi-webui.git
cd miwifi-webui
```

#### 2. Configure Environment

Copy `.env.example` to `.env` and generate an application master key:

```bash
cp .env.example .env

# Generate a 32-byte base64 master key for encrypting router credentials:
openssl rand -base64 32
```

Open `.env` in your editor:
- Set `APP_MASTER_KEY` to the generated base64 string.
- Set a strong `POSTGRES_PASSWORD`.

#### 3. Start the Stack

```bash
docker compose up -d --build
```

This starts PostgreSQL, the Fastify API backend, and the Web UI frontend.

#### 4. Create Initial Administrator

For security (ADR 0003), first-run bootstrap creates a single administrator and then locks permanently. In container deployments, create the admin account via CLI:

```bash
docker compose exec -e ADMIN_PASSWORD="YourSecurePassword123!" api node dist/cli/admin.js create admin
```

> **Requirements**:
> - `ADMIN_PASSWORD` must be at least 10 characters long.
> - Username must be 3–32 characters (`[a-zA-Z0-9_.-]`).

#### 5. Log in and Onboard Your Router

1. Open **http://localhost** (or the port specified in `WEB_PORT`) in your browser.
2. Log in with your newly created admin credentials.
3. Navigate to **Settings** -> **Router Configuration**.
4. Enter your Xiaomi router's IP address (e.g. `192.168.31.1`) and your router admin password.
5. Click **Probe & Save**. The backend will verify compatibility, encrypt credentials at rest, and begin background telemetry polling!

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
