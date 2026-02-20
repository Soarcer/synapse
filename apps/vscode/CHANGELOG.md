# Changelog

## 0.2.0 — 2026-02-19

### Added
- Extension icon
- CHANGELOG, LICENSE files
- Cursor install instructions and compatibility section in README

### Fixed
- Sourcemaps no longer included in .vsix (saves ~200 KB)
- WorkshopModal model selector type error
- Security hardening: helmet.js, Zod error flattening, API error sanitization, model allowlist, value length validation, snapshot sessionId validation
- Stability: nudge dismiss rollback on failure, WS malformed message logging, backpressure toast
- Accessibility: focus traps in dialogs, ARIA labels on SessionSelector

---

## 0.1.0 — 2026-02-18

Initial beta release.

### Features
- Interactive node graph — sessions, agents, subagents, and tool calls as connected nodes with animated edges
- Six lens views: Tree, Heatmap, Treemap, Sankey, Compaction, Cost
- Split or single layout mode (sidebar + editor panel, or full dashboard)
- Real-time WebSocket streaming with pause/resume
- Embedded server — auto-starts on activation, auto-stops on deactivate
- Zero-config hook setup — detects `.claude/` directory and configures hooks automatically
- Settings panel with four tabs: Hooks, Server, Display, Data
- Explorer tree view showing active agents
- Status bar with live agent/tool counts
- Keyboard shortcut forwarding from dashboard webview to VS Code
- Cursor compatibility — works in Cursor with standard VS Code extension APIs

### Technical
- ~1.6 MB `.vsix` — bundles server, React dashboard, and hook scripts
- Pure JavaScript SQLite (sql.js) — no native binaries, no WASM files
- Database persisted between sessions
- Auto port fallback if preferred port is busy
