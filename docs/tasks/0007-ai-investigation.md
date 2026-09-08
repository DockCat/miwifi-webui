# Task 0007 — AI Investigation

Status: `DONE`

Historical note: Task 0012 supersedes the older per-category egress wording
below. External providers always receive aliases for MACs, IPs and device
names; no names opt-out is supported.

Task ID: `0007`

Related plan: `docs/plans/0001-product-foundation.md` (Phase 7, sections 27-34)

## Objective

Add the optional, read-only AI investigation layer: provider abstraction
(disabled / local OpenAI-compatible / external), narrow read-only tools
over normalized application data (router health, device state, presence
history, telemetry history, evidence lookup) with bounded inputs/outputs,
investigation + evidence persistence, explicit privacy/pseudonymization
controls for external providers, and the Investigations UI.

## Security requirements

* AI disabled by default; no external egress until the administrator
  configures and enables a provider.
* v1 tools are read-only — no mutation tools exist in the tool registry.
* Tools have explicit input/output schemas, bounded time ranges and
  result counts; no credential fields; no unrestricted SQL.
* External providers receive pseudonymized context (router_01, device_01,
  …); MAC/IP/serial/raw names are never sent as an egress opt-in.
* Never transmitted: router password, stok, Wi-Fi password, master key,
  AI API key, secret-bearing URLs.
* Investigation content retained ~30 days (retention job); audit records
  who/when/provider/tools/status.

## Acceptance criteria

* Provider registry: disabled by default; OpenAI-compatible endpoint
  (base URL + model) usable for local providers.
* Tool registry with five read-only tools, each schema'd + bounded.
* Pseudonymization applied to external egress; unit-tested.
* Investigation sessions persisted with evidence links; findings returned
  as structured output.
* UI: Investigations view — start session, view findings + evidence ids.
* Tests: tool schemas reject out-of-range inputs; pseudonymizer redacts;
  provider disabled by default; no mutation tools exist.
* All quality gates pass.

## Completion record

Status: `DONE` — completed 2026-09-05.

### Implementation summary

* Provider abstraction: disabled (default) / local / external via env
  (AI_PROVIDER_MODE/BASE_URL/MODEL/API_KEY); OpenAI-compatible
  chat-completions client; local providers pass identifiers, external
  providers get pseudonymized egress (MAC/IP/names always aliased — the
  former AI_EGRESS_ALLOW_* per-category switches were removed in the
  2026-09-05 security pass as unmanageable; readability is restored via the
  alias legend stored with each investigation, never sent to the provider).
* Tool registry — five read-only tools, each with structural validation,
  bounded limits (<=50) and time windows (<=30 days), fixed parameterized
  SQL only: router_status, device_state, presence_history, audit_history,
  evidence_lookup. No mutation tool exists; names assert absence of
  block/reboot/reset/wifi tools in tests. Unknown tool names return null.
* Agent loop: bounded 8 iterations, system prompt enforcing read-only
  investigator + evidence citation; evidence_lookup calls recorded as
  evidence links; tool results pseudonymized per-call for external mode.
* Persistence: investigation + investigation_evidence tables (migration
  0006); daily retention purge (~30 days) in the scheduler; audit records
  started/completed/failed with provider/model/reason (bounded, no
  question text, no secrets).
* UI: Investigations view — start session, list, findings with
  inspectable evidence ids; AI-disabled surfaces a clear hint; nav entry
  added (zh-CN + en labels).

### Verification

* 12 AI tests: provider disabled-by-default, mode requirements,
  external privacy defaults, tool bounds (limit/window/kind/id), no
  mutation tools, unknown-name rejection, MAC/IP/names pseudonymization,
  stable case-insensitive aliases, secret-key/URL redaction (found and
  fixed a real stateful-regex lastIndex bug during verification).
* Gates: typecheck 0, lint 0, 95 tests, build OK; migration 0006 applied.

### Follow-up work

Task 0008 — Hardening: retention jobs for telemetry, backup/restore docs,
extended compatibility fixtures, failure-mode tests, deployment hardening.
