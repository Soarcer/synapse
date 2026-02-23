# Synapse Multimodal / Multi-Agent Support Plan

Date: 2026-02-22

## Problem Statement

You want Synapse to support additional agent ecosystems (ChatGPT/Codex, Gemini, OpenRouter and others) using the same reliability as current Claude hook + transcript ingestion.

This plan consolidates:

- Existing internal plans already in the repo
- Actual current runtime ingestion behavior in code
- Practical integration patterns for additional providers/tools

## Existing Docs You Already Have (Key Findings)

Primary existing plan:

- `docs/MULTI_VENDOR_PLAN.md`
  - Integration taxonomy is already defined (`Pattern 1 hooks`, `Pattern 2 file watchers`, `Pattern 3 embedded plugin`).
  - Includes phased roadmap for Gemini and Codex adapters.

Supporting technical references:

- `docs/GEMINI_INTEGRATION.md`
- `docs/CODEX_INTEGRATION.md`
- `docs/CODEX_FORMATS.md`
- `docs/ANALYTICS_IMPLEMENTATION_PLAN.md` (import/normalization notes)

## Current Runtime Ingestion (What Is Actually Implemented)

### 1) Hook pipeline (Claude-focused)

Current flow:

1. Claude hook runs `hooks/send_event.cjs`
2. Script reads JSON from stdin
3. Script POSTs to `/api/events` with 3-second timeout
4. Server normalizes in `normalizeHookPayload()`
5. Event stored in SQLite and broadcast to dashboard

Evidence in code:

- `hooks/send_event.cjs` has Claude-shaped payload assumptions and timeout posting.
- `packages/server/src/services/eventStore.ts` has `HOOK_EVENT_MAP` and `normalizeHookPayload()` mapped to Claude hook names.
- `packages/server/src/routes/events.ts` treats only `eventSource === 'openclaw'` as pre-normalized bypass; everything else goes through hook normalization.

### 2) Historical transcript indexing (Claude paths)

- `packages/server/src/services/transcriptScanner.ts` scans under `~/.claude/projects/<project-hash>`.
- Triggered by `/api/transcript/scan` in `packages/server/src/routes/transcript.ts`.

### 3) Multi-provider import path exists (batch, not live)

- `/api/analytics/import` exists in `packages/server/src/routes/analytics.ts`.
- Uses `importCsv()` / `importJson()` from `packages/server/src/services/importService.ts`.
- Provider mapping logic exists in `packages/server/src/services/providerNormalizer.ts`.

Interpretation:

- You already support non-Claude data ingestion in **import mode**.
- Live real-time ingestion remains Claude-first plus OpenClaw pre-normalized events.

### 4) OpenClaw path is already multi-vendor capable

- OpenClaw has provider wrapper layer and JSONL bridge.
- `inferVendor()` already recognizes `openrouter/` model prefixes.
- This gives you one high-leverage path for OpenRouter/LiteLLM-backed agents when they run inside OpenClaw.

## External Reality Check (2026-02)

### Gemini CLI

- Public docs/repo indicate active CLI development and structured output modes.
- Your internal Gemini integration doc remains directionally correct: hooks + transcript files are the best path.

### Codex / ChatGPT coding agent path

- Codex CLI is available and can authenticate via ChatGPT account or API key.
- Treat Codex as the reliable local integration point for OpenAI/ChatGPT coding sessions.
- Your existing assumption still holds: file/session artifacts are the primary robust telemetry source; notify hooks are supplementary.

### ChatGPT web app

- Real-time local hooks/logs are not a stable integration surface.
- Practical ingestion options are:
  1. Codex CLI sessions (preferred for engineering workflows)
  2. Data export import (ChatGPT export ZIP includes `chat.html`) for retrospective analytics only

### OpenRouter

- OpenRouter API is OpenAI-compatible and returns normalized `usage` and optional `cost` metadata.
- OpenRouter is infrastructure, not a coding assistant UI: support is best implemented through tool adapters and/or provider-level wrappers (already aligned with your plan).

## Recommended Architecture (Updated, Practical)

Keep your existing 3-pattern model. Implement in this order:

1. **Adapter registry in server (highest leverage)**
   - Replace Claude-hardcoded normalization dispatch with pluggable detection + normalizer modules.
   - Preserve backward compatibility by keeping Claude adapter first.

2. **Gemini adapter (hooks first, files second)**
   - Add Gemini hook normalizer + detector.
   - Add optional transcript watcher for backfill/recovery.

3. **Codex adapter (files first, notify second)**
   - Add Codex JSONL watcher parser.
   - Add cumulative-token-to-delta tracker.
   - Add notify endpoint/parser for `agent-turn-complete` style events.

4. **OpenRouter enhancements (optional but valuable)**
   - Keep current model-prefix vendor inference.
   - Add optional generation stats enrichment using returned generation IDs for post-hoc cost reconciliation.

5. **ChatGPT web export importer (retrospective only)**
   - Add importer module for ChatGPT export bundle (start with `chat.html` parsing).
   - Mark source as `eventSource: 'import'` to avoid mixing with live telemetry semantics.

## Feasibility Matrix

- Claude Code: Live hooks + transcript indexing (already good)
- Gemini CLI: High feasibility (hooks + transcript files)
- Codex CLI: Medium-high feasibility (session files primary, notify secondary)
- ChatGPT Web: Low for live telemetry, medium for retrospective import
- OpenRouter: High via existing wrappers/adapters; direct “agent” adapter unnecessary
- Other tools (Aider/Cursor/Windsurf): Pattern-based; choose hook vs file strategy per tool

## Key Gaps To Close In Current Code

1. Hardcoded Claude normalization in event store
2. Source detection coupled to magic strings (OpenClaw special case)
3. Transcript scanning currently Claude-directory specific
4. No first-class adapter health/observability endpoint
5. No unified dedupe strategy across hook + file sources

## Concrete Implementation Steps

### Phase 0 — Stabilize Core Contract (small)

- Add explicit `eventSource` enum extension for `hook | file | openclaw | import | sdk`.
- Add `sourceAdapter` field (e.g., `claude`, `gemini`, `codex`) in normalized events.
- Add adapter health table or in-memory map.

### Phase 1 — Adapter Registry (server refactor)

- Introduce `AdapterRegistry` in `packages/server`.
- Move current Claude mapping out of `eventStore.ts` into `adapter-claude` module/package.
- Route `/api/events` payloads via detector chain.

### Phase 2 — Gemini Adapter

- Hook script (stdin) + detector + normalizer.
- Vendor-prefixed session IDs (`gemini-...`) to avoid collisions.
- Optional watcher for `~/.gemini/...` chat files.

### Phase 3 — Codex Adapter

- Session watcher for `~/.codex/sessions/...`.
- Notify hook parser (argv-based payload, not stdin).
- Token delta tracker for cumulative counters.

### Phase 4 — Import/Proxy Enrichment

- Add OpenRouter generation stats backfill mode (optional).
- Add ChatGPT export importer for retrospective analysis.

## Operational Guidance

- Keep hook scripts fire-and-forget and timeout-bounded.
- Prefer event-level idempotency keys over only short-window dedupe.
- Prefix session IDs by adapter/vendor consistently.
- Treat transcript/file watchers as eventually consistent backfill, not sole truth source where hooks exist.

## Outcome You Can Expect

After Phases 1–3, Synapse will support:

- Real-time: Claude + Gemini + Codex (where available)
- Retrospective: Claude transcripts + Codex/Gemini files + imports
- Cross-vendor analytics: Anthropic, OpenAI/ChatGPT (via Codex/API/import), Google, OpenRouter-routed models

This gives you a sustainable, provider-agnostic ingestion foundation without breaking current Claude functionality.
