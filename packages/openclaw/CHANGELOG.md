# Changelog

## 0.2.0 (2026-03-17)

### Breaking Changes

- Requires OpenClaw >= 2026.3.0 (modern `register(api)` plugin pattern)
- Legacy `init(config, deps)` entry point removed
- TypeBox `@sinclair/typebox` dependency removed — config schema now lives in `openclaw.plugin.json`

### Migration from 0.1.x

1. Update OpenClaw to >= 2026.3.0
2. Update plugin: `openclaw plugins install @synapse-ai/openclaw@0.2.0`
3. Config format is unchanged — no config migration needed
4. If using tool allowlists, tools are now registered as `optional` — add `"tools": { "allow": ["synapse-monitor"] }` to your agent config

### New Features

- `/synapse` command for quick dashboard status
- Lazy server startup — tools wait for server on first use, plugin `register()` no longer blocks
- Port collision detection — reuses existing Synapse server or fails fast on port conflict
- Pre-built server bundle — no `tsx` runtime dependency, sub-second cold start

### Improvements

- Pricing uses `@synapse-ai/core` with full cache-aware + thinking-token cost calculation
- Updated model pricing: Gemini 2.5 Pro/Flash, o1, o3-mini, gpt-4o-mini, dated model variants
- Removed `better-sqlite3`, `express`, `ws` from direct dependencies (bundled in server)

## 0.1.0 (2026-02-12)

- Initial release with legacy `init(config, deps)` plugin pattern
- Three monitoring layers: JSONL transcript watcher, agent tools, provider wrapper
