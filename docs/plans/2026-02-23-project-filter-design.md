# Project/CWD Filter in SessionSelector

**Date**: 2026-02-23

## Problem

The CLI uses a single-daemon model — one server process receives events from all projects. Sessions from different projects (Synapse, FoilWithUs, etc.) appear mixed together with no way to filter. The VS Code extension avoids this by passing `?cwd=` in the webview URL, but the standalone browser dashboard has no equivalent UI.

## Design

**Approach: Client-side filter inside SessionSelector** (no new server endpoints).

### Data flow (already wired)

- `AgentEvent.cwd` flows from hook scripts → server (stored in SQLite) → WS → dashboard
- `SessionData.cwd` is populated in `eventHandlers.ts` (`ensureSession` + `handleSessionStart`)
- `agentStore.cwdFilter` controls WS event filtering + HTTP fetch `?cwd=` param
- `normalizeCwd()` from `@synapse-ai/core` handles cross-platform path normalization

### UI changes (SessionSelector.tsx only)

1. **Extract projects**: derive `Map<normalizedCwd, projectName>` from `sessions.values()`. Project name = last path segment of `cwd` (e.g., `C:\Workspace\Coding\Prototypes\Synapse` → `Synapse`). Full path shown as tooltip.

2. **Filter pills**: at the top of the SessionSelector popover (above vendor pills), show project filter pills when 2+ projects exist: `All | Synapse | FoilWithUs | ...`. Selecting a pill sets `cwdFilter` in the store.

3. **Grouped session list**: when "All" is selected, sessions are grouped under collapsible project headers (`▸ Synapse (4 sessions)`, `▸ FoilWithUs (2 sessions)`). When a specific project is selected, flat list (no grouping needed).

4. **Re-fetch on filter change**: when `cwdFilter` changes, call `loadEvents()` which already passes `?cwd=` to the server. The WS handler already skips events that don't match `cwdFilter`.

5. **Header button label**: when a project filter is active, show project name as subtitle on the Sessions button: `Sessions ↕ [Synapse]`.

6. **VS Code mode**: when `?cwd=` is in the URL (VS Code), `cwdFilter` is pre-set and only one project exists — pills are hidden automatically (existing `vendors.length > 1` pattern).

### Store changes (agentStore.ts)

- Add `setCwdFilter(cwd: string | null)` action (or reuse existing mechanism — `cwdFilter` is already in state, just needs a setter exposed to UI)
- On filter change: clear current state, re-fetch events with new `?cwd=` param

### Files to modify

- `apps/dashboard/src/components/layout/SessionSelector.tsx` — project pills, grouped list, header label
- `apps/dashboard/src/store/agentStore.ts` — `setCwdFilter` action + re-fetch logic

### Not needed

- No new server endpoints (client derives project list from session data)
- No new packages or dependencies
- No changes to hook scripts, adapters, or event pipeline
