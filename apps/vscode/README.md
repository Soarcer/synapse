<p align="center">
  <br />
  <code>&nbsp;S Y N A P S E&nbsp;</code>
  <br />
  <strong>Real-time agent observability for Claude Code — inside your editor</strong>
  <br />
  <em>The flight control tower moved into the cockpit.</em>
  <br />
  <br />
  <a href="#getting-started">Getting Started</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="#settings">Settings</a>
  <br />
  <br />
</p>

---

## What Is This?

Synapse is a **visual, real-time dashboard** that shows you exactly what Claude agents are doing — tool calls, subagent spawns, token usage, session lifecycles — rendered as an interactive node graph you can zoom, pan, click, and actually *understand*.

This extension embeds the entire Synapse stack directly into VS Code. No browser tab. No external server. No second monitor dedicated to "watching the AI think." Just open a Claude Code project and the dashboard appears, automatically wired up and streaming events.

The `.vsix` is ~1.2 MB. It bundles the server, the React dashboard, and the hook scripts into a single package with zero native dependencies. We replaced SQLite's C bindings with pure JavaScript because we care about your build toolchain's blood pressure.

> **Status:** Prototype. Works well. Has personality. Some edges are load-bearing.

---

## Features

### Interactive Node Graph
Sessions, agents, subagents, and tool calls rendered as connected nodes with animated edges. Color-coded by status — green for running, gray for done, red for "well, that didn't work." New nodes animate into position as agents spawn and tools fire in real-time.

### Six Lens Views

The sidebar isn't just a file tree — it's a switchable analysis panel with six ways to slice the same data:

| Lens | Tab | What It Shows |
|------|-----|---------------|
| **Tree** | `Tree` | Hierarchical explorer — sessions, prompts, agents, tools. Consecutive identical calls auto-grouped (`Read x14`). |
| **Heatmap** | `Heat` | Activity heatmap — tools vs. time, colored by call count or token usage. |
| **Treemap** | `TMap` | Squarified treemap — rectangle area = tokens, duration, or call count. Spot the agent burning 80% of your budget. |
| **Sankey** | `Flow` | Flow diagram — Sessions → Prompts → Agents → Tools. Band width = resource flow. |
| **Compaction** | `Comp` | Context compaction timeline. The sawtooth pattern that explains "why did Claude forget what I said." |
| **Cost** | `Cost` | Per-turn cost waterfall — tokens, cache hits, model used, latency, estimated USD. |

### Split or Single Layout
- **Split mode** (default): Lens panel in the sidebar, graph in a separate editor tab. Both sync bidirectionally.
- **Single mode**: Full dashboard in one editor panel. Maximum screen real estate.

### Real-Time Streaming
Events arrive over WebSocket as they happen, not after. The graph updates live. The status bar shows active agent and tool call counts. You can pause the stream without losing events.

### Settings Panel
Click the gear icon in the Synapse sidebar to open the settings panel — four tabs for hooks management, server diagnostics, display preferences, and data management. All without leaving VS Code.

### Zero-Config Setup
Open a project with a `.claude/` directory. Synapse auto-starts its embedded server, configures the hook scripts, and opens the dashboard. That's it. If the preferred port is busy, it finds the next available one. If you close VS Code, the server stops with it.

---

## Getting Started

### Prerequisites
- **VS Code** 1.95+
- **Node.js** 20+ (Claude Code requires this anyway)
- **Claude Code** installed (for live hook events — works with simulated data too)

### Installation

**From `.vsix` file:**
```
code --install-extension synapse-vscode-0.1.0.vsix
```

**From source:**
```
cd apps/vscode
npm run build
npm run package
code --install-extension synapse-vscode-0.1.0.vsix
```

### Usage

1. Open any project that has a `.claude/settings.json` or `.claude/settings.local.json`
2. Synapse auto-starts (see the `$(pulse)` icon in the activity bar)
3. The dashboard opens automatically — start a Claude Code session and watch the graph light up

If you don't have a live session, the extension still works — you can browse historical events stored in the embedded database.

---

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| **Synapse: Open Dashboard** | Open or reveal the graph panel |
| **Synapse: Start Server** | Start the embedded Synapse server |
| **Synapse: Stop Server** | Stop the server |
| **Synapse: Configure Hooks** | Wire up Claude Code hooks for this project |
| **Synapse: Remove Hooks** | Remove Synapse hooks from this project |
| **Synapse: Switch Lens View** | Pick a lens (Tree, Heat, TMap, Flow, Comp, Cost) |
| **Synapse: Reconnect** | Reset the WebSocket connection |
| **Synapse: Settings** | Open the settings panel (also via gear icon in sidebar) |

---

## Settings

Configure via VS Code Settings (`Ctrl+,`) or the Synapse Settings panel:

### Core

| Setting | Default | Description |
|---------|---------|-------------|
| `synapse.port` | `4000` | Preferred port. Auto-finds next available if busy. |
| `synapse.autoStart` | `true` | Start server automatically when opening a Claude project |
| `synapse.layout` | `split` | `split`: sidebar + editor panel. `single`: full dashboard in one panel. |

### Display

| Setting | Default | Description |
|---------|---------|-------------|
| `synapse.animationSpeed` | `normal` | Edge/node animation speed: `off`, `slow`, `normal`, `fast` |
| `synapse.defaultLens` | `tree` | Sidebar lens on startup: `tree`, `heat`, `tmap`, `flow`, `comp`, `cost` |
| `synapse.nodeLabelDensity` | `normal` | Node detail level: `minimal`, `normal`, `verbose` |
| `synapse.edgeStyle` | `smoothstep` | Edge routing: `smoothstep`, `bezier`, `straight` |
| `synapse.autoZoom` | `fit-all` | Zoom behavior: `fit-all`, `follow-latest`, `manual` |
| `synapse.themeOverride` | `auto` | Dashboard theme: `auto` (follows VS Code), `dark`, `light` |

### Data

| Setting | Default | Description |
|---------|---------|-------------|
| `synapse.maxEvents` | `0` | Max events retained in database. `0` = unlimited. |

---

## How It Works

```
Claude Code ──hook scripts──► Embedded Server ──WebSocket──► Dashboard WebView
                                    │
                              SQLite (sql.js)
                              pure JS, no WASM
```

1. Claude Code runs your session normally. Hook scripts (configured in `.claude/settings.local.json`) silently capture events and POST them to the embedded Synapse server.
2. The server normalizes events, stores them in an in-memory SQLite database (sql.js — pure JavaScript, no native binaries), and broadcasts them over WebSocket.
3. The React dashboard runs inside VS Code webview panels, receives events in real-time, and renders the interactive node graph.
4. Everything is bundled. The server, the dashboard, the hook scripts — all packed into a single `.vsix`. When VS Code closes, the server stops. When it opens, the server starts. No orphaned processes. No port conflicts. Probably.

---

## Known Limitations

Let's be honest:

- **No authentication** — The embedded server listens on localhost only. Don't port-forward it to the internet unless you enjoy surprise visitors.
- **Node.js required** — The extension spawns a Node.js process for the server. If Node isn't on your PATH, Synapse will politely tell you to install it and offer a download link.
- **Windows-first development** — Built and tested primarily on Windows. Works on macOS and Linux, but if you find a platform-specific issue, we want to hear about it.
- **Test coverage** — The testing framework is installed and configured. The actual tests are... aspirational. Like a gym membership in January.
- **Display preferences** — The new display settings (animation speed, edge style, etc.) are stored and ready. Dashboard-side consumption of these preferences is a work in progress — your settings are being saved, they're just not all wired up to the renderer yet.

---

## Links

- [Full documentation](https://github.com/YOUR_USERNAME/synapse) — Root README with complete architecture docs, API reference, and the Roadmap of Ambition
- [Report an issue](https://github.com/YOUR_USERNAME/synapse/issues) — We catalogued 104+ known issues ourselves. Yours might be new. That's exciting.

---

<p align="center">
  <sub>Built with curiosity, caffeine, and an mass amount of Claude.</sub>
  <br />
  <sub>~1.2 MB of "what is my AI doing right now" energy, packaged for your editor.</sub>
</p>
