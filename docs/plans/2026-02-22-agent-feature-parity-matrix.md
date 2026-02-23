# Agent Feature Parity Matrix and Rollout Plan

Date: 2026-02-22

## Scope

Compare current Synapse functionality (Claude-first) against other agent ecosystems and define:

- Expected feature parity
- Missing implementation pieces
- Additional capabilities you can add per ecosystem
- Prioritized rollout with effort/risk/impact

## Baseline (Current State)

Current strongest lane is Claude Code:

- Live hook ingestion to /api/events
- Hook normalization in server event store
- SQLite persistence + WS broadcast
- Transcript scan/index pipeline (Claude directory structure)

Also present today:

- Import lane for CSV/JSON provider data (analytics import endpoint)
- OpenClaw pathway with multi-vendor normalization and optional provider wrapper

## Feature Definitions

- Session lifecycle: session_start/session_end visibility
- Prompt capture: user prompt text capture
- Tool telemetry: tool_start/tool_end/tool_error with names/inputs/results
- Subagent tracking: nested agent start/stop
- Token usage: input/output token accounting
- Cost estimation: per-event or per-session spend estimates
- Real-time stream: near-live updates in dashboard
- Transcript replay: historical full-session reconstruction
- Multi-vendor attribution: vendor/model labeling consistency
- Setup automation: easy install/configure path for users

## Capability Matrix

| Agent / Vendor Path                         | Session Lifecycle          | Prompt Capture             | Tool Telemetry             | Subagent Tracking                | Token Usage                            | Cost Estimation            | Real-Time Stream                 | Transcript Replay             | Multi-Vendor Attribution         | Setup Automation              | Current Status                                  | Missing Today                                                                      | Additional You Can Add                                                                    |
| ------------------------------------------- | -------------------------- | -------------------------- | -------------------------- | -------------------------------- | -------------------------------------- | -------------------------- | -------------------------------- | ----------------------------- | -------------------------------- | ----------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Claude Code                                 | Full                       | Full                       | Full                       | Full                             | Partial-Strong                         | Strong                     | Full                             | Strong                        | Strong                           | Strong (VS Code hook manager) | Production baseline                             | Adapter modularization (currently hardcoded normalization path)                    | Adapter registry, event idempotency keys, richer adapter health telemetry                 |
| Gemini CLI                                  | Planned Full               | Planned Full               | Planned Full               | N/A/limited by provider behavior | Planned Strong                         | Planned Strong             | Planned Full                     | Planned Strong                | Planned Strong                   | Planned                       | Design complete, not wired                      | Missing detector/normalizer registration, hook installer path, watcher integration | Dual-mode ingestion (hooks + watcher), Gemini-specific tool taxonomy, resilience tests    |
| Codex CLI (OpenAI)                          | Planned Strong             | Planned Strong             | Planned Strong             | Limited/depends on format        | Planned Strong (with delta conversion) | Planned Strong             | Planned Strong                   | Planned Strong                | Planned Strong                   | Planned                       | Design complete, not wired                      | Missing JSONL watcher, notify adapter, cumulative-token delta tracker              | Codex event schema versioning guardrails, replay integrity checks, sidecar health metrics |
| ChatGPT Web                                 | Retrospective only         | Retrospective only         | Limited retrospective      | No                               | Partial via export parsing             | Partial via import         | No direct local live hook stream | Partial via export parsing    | Medium (post-normalization)      | Low today                     | Not integrated live                             | No stable live local telemetry source                                              | Add ChatGPT export importer lane and map to import source type                            |
| OpenRouter (as proxy)                       | Via underlying tool        | Via underlying tool        | Via underlying tool        | Via underlying tool              | Strong (API usage fields)              | Strong (usage/cost fields) | Via underlying tool stream       | Via underlying tool artifacts | Strong                           | Medium                        | Partially covered via vendor inference/wrappers | Missing dedicated spend reconciliation and generation stats enrichment in server   | Add OpenRouter stats reconciler, proxy-specific dashboards, per-model routing analytics   |
| Groq / Other OpenAI-compatible providers    | Via import or wrapped tool | Via import or wrapped tool | Via import or wrapped tool | Tool-dependent                   | Medium-Strong                          | Medium-Strong              | Tool-dependent                   | Tool-dependent                | Strong if model mapping is clean | Medium                        | Partial via provider normalizer/import          | Missing first-class live adapters unless routed through supported tool/framework   | Add adapter templates for OpenAI-compatible schemas and dynamic vendor mapping            |
| OpenClaw Runtime (multi-provider framework) | Strong                     | Strong                     | Strong                     | Framework-dependent              | Strong                                 | Strong                     | Strong                           | Strong                        | Strong                           | Medium                        | Implemented path exists                         | Not a universal replacement for CLI-native adapters                                | Enable providerWrapper for deeper inference timing, add unified pricing source            |

## Gap Summary by Agent

### Gemini CLI

Missing:

- Production adapter package and server registration
- Hook setup automation and validation checks
- Optional file watcher for backfill

Add:

- Hook-first ingestion for low latency
- File watcher backfill for reliability
- Session ID vendor prefixing and adapter health endpoint

### Codex CLI

Missing:

- File watcher implementation in production server pipeline
- Notify hook parser path wired to adapter flow
- Cumulative token to delta conversion state

Add:

- Robust JSONL replay parser and schema evolution guards
- Delta token tracker with reset handling
- Dual-source dedupe (notify plus file watcher)

### ChatGPT Web

Missing:

- Practical live local telemetry surface

Add:

- Historical importer for data export package
- Conversation-level normalization for analytics and coaching insights

### OpenRouter

Missing:

- Explicit server-side cost reconciliation job
- Proxy-aware analytics views

Add:

- Generation ID reconciliation path
- Provider routing and fallback analytics
- Spend anomaly detection by model/provider pair

## Prioritized Implementation Matrix

| Priority | Work Item                                                  | Agents Affected     | Effort      | Risk       | Impact      | Estimated Delivery | Why First                                                      |
| -------- | ---------------------------------------------------------- | ------------------- | ----------- | ---------- | ----------- | ------------------ | -------------------------------------------------------------- |
| P0       | Adapter registry refactor in server                        | All future adapters | Medium      | Medium     | Very High   | 2-4 days           | Removes Claude-hardcoding and unlocks all integrations cleanly |
| P1       | Gemini hook adapter (detector + normalizer + registration) | Gemini              | Medium      | Low-Medium | High        | 2-3 days           | Fastest parity gain; hook model closest to Claude              |
| P2       | Gemini transcript watcher (optional backfill)              | Gemini              | Medium      | Medium     | Medium-High | 2-3 days           | Improves reliability and historical completeness               |
| P3       | Codex file watcher + parser                                | Codex/OpenAI        | Medium-High | Medium     | High        | 3-5 days           | Primary Codex telemetry channel                                |
| P4       | Codex cumulative token delta tracker                       | Codex/OpenAI        | Medium      | Medium     | High        | 1-2 days           | Required for accurate cost/token analytics                     |
| P5       | Codex notify integration + dedupe with watcher             | Codex/OpenAI        | Medium      | Medium     | Medium      | 1-2 days           | Better near-real-time responsiveness                           |
| P6       | OpenRouter reconciliation service                          | OpenRouter          | Medium      | Medium     | Medium-High | 2-3 days           | Improves spend accuracy and proxy observability                |
| P7       | ChatGPT export importer                                    | ChatGPT Web         | Medium      | Low-Medium | Medium      | 2-4 days           | Adds retrospective visibility where live hooks are unavailable |
| P8       | Unified adapter health endpoint + diagnostics UI hooks     | All                 | Low-Medium  | Low        | Medium      | 1-2 days           | Simplifies troubleshooting and support at scale                |

## Suggested Milestone Plan

- Milestone 1: P0 + P1
  - Outcome: Claude and Gemini live side-by-side in one normalized pipeline
- Milestone 2: P2 + P3 + P4
  - Outcome: Reliable Gemini backfill and accurate Codex telemetry
- Milestone 3: P5 + P6 + P7 + P8
  - Outcome: Mature multi-vendor observability with reconciliation and diagnostics

## Success Criteria

- Events from Claude, Gemini, and Codex appear in same analytics queries with correct vendor attribution
- Token and cost metrics align with source provider expectations (including Codex delta logic)
- Duplicate events remain under agreed threshold with dual-source ingestion
- Setup for each supported agent path is scriptable and validated
