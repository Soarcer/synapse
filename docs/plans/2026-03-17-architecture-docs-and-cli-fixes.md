# Architecture Docs & CLI Fixes

## Problem

1. `synapse stop` uses `SIGKILL` — no-op on Windows (same bug we fixed in serverManager.ts)
2. Relay files linger in `$TEMP` after `synapse stop`
3. No documentation covering the 3 usage modes, server topology, or file relay lifecycle
4. Launch checklist missing "documentation pass" item

## Tasks

### T1: Fix Windows kill in daemon.ts

- Replace `process.kill(pid, 'SIGKILL')` with platform-aware taskkill
- Match the pattern from serverManager.ts

### T2: Add relay cleanup to stop()

- On `synapse stop`, delete `$TEMP/synapse_relay_<port>.jsonl` and `$TEMP/synapse_relay_offset_<port>.json`
- Also delete circuit breaker file `$TEMP/synapse_cb_<port>.json`

### T3: Write architecture docs

- Add "Server Architecture" section to `docs/ARCHITECTURE.md` covering:
  - 3 ports (main, hook, fallback)
  - 3 usage modes (VS Code, CLI, dev)
  - Hook configuration (auto vs manual)
  - File relay lifecycle (relay file, offset, 5MB cap, compaction)
  - Circuit breaker behavior

### T4: Add documentation pass to launch checklist

- Add item to `docs/launch-checklist.html` (or wherever it lives)
