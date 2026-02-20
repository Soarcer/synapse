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
  <a href="#analytics">Analytics</a> &bull;
  <a href="#commands">Commands</a> &bull;
  <a href="#settings">Settings</a>
  <br />
  <br />
</p>

---

## What Is This?

Synapse is a **visual, real-time dashboard** that shows you exactly what Claude agents are doing — tool calls, subagent spawns, token usage, session lifecycles — rendered as an interactive node graph you can zoom, pan, click, and actually *understand*.

This extension embeds the entire Synapse stack directly into VS Code. No browser tab. No external server. No second monitor dedicated to "watching the AI think." Just open a Claude Code project and the dashboard appears, automatically wired up and streaming events.

The `.vsix` is ~1.5 MB. It bundles the server, the React dashboard, and the hook scripts into a single package with zero native dependencies. We replaced SQLite's C bindings with pure JavaScript because we care about your build toolchain's blood pressure.

> **Status:** Prototype. Works well. Has personality. Some edges are load-bearing.

---

## Features

### Interactive Node Graph
Sessions, agents, subagents, and tool calls rendered as connected nodes with animated edges. Color-coded by status — green for running, gray for done, red for "well, that didn't work." New nodes animate into position as agents spawn and tools fire in real-time.

### Tool Call Grouping
Individual tool calls are grouped into composite nodes per agent, replacing the visual confetti of 47 separate Read nodes. Three visualization modes:

| Mode | What It Shows |
|------|---------------|
| **Pill Grid** | Color-coded tool pills in a compact grid — tool name, count, status dots |
| **Timeline** | Chronological swimlanes — see which tools ran when and for how long |
| **Heatmap** | Density grid — color intensity = call count or duration. Spot the hot tools at a glance |

Toggle between collapsed chips and expanded detail with **F**. Switch visualization modes in the View Settings dropdown.

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

### Graph Stats Bar
The header shows a live summary — prompt count, agent count, tool count, total tokens, estimated cost, and session duration. All computed from the actual graph data, not from hopes and dreams.

### Split or Single Layout
- **Split mode** (default): Lens panel in the sidebar, graph in a separate editor tab. Both sync bidirectionally.
- **Single mode**: Full dashboard in one editor panel. Maximum screen real estate.

### Real-Time Streaming
Events arrive over WebSocket as they happen, not after. The graph updates live. The status bar shows active agent and tool call counts. You can pause the stream without losing events.

### Settings Panel
Click the gear icon in the Synapse sidebar to open the settings panel — three tabs for hooks management, server diagnostics (including AI features), and data management. Core display settings (port, auto-start, layout) live in VS Code's native settings (`Ctrl+,`).

### Zero-Config Setup
Open a project with a `.claude/` directory. Synapse auto-starts its embedded server, configures the hook scripts, and opens the dashboard. That's it. If the preferred port is busy, it finds the next available one. If you close VS Code, the server stops with it.

---

## Analytics

The analytics page is a separate view accessible from the dashboard header. It operates on aggregated data across sessions — the graph shows you *what's happening now*, analytics shows you *what happened over time*.

Global filters (time range, project, session) sit at the top and apply to all tabs. They persist across reloads.

### Five Tabs

| Tab | What It Does |
|-----|--------------|
| **Executive** | KPI overview with sparklines — total cost, tokens, tool calls, sessions, latency percentiles, cache hit rates. Model and tool breakdowns as pie charts. AI-generated session summaries with ROI metrics. |
| **Prompts** | Prompt analysis — complexity scoring, cost/token scatter plots, category classification. Expand any prompt for token breakdown, tool badges, and full text. AI-powered prompt scoring with rewrite suggestions in two modes: *Developer* (technical, concise) and *Vibe* (casual, opinionated). |
| **Workshop** | Draft and refine prompts before sending them. Type a prompt, pick a model and analysis mode, get a score with explanation and rewrite. Copy the improved version or send it directly to a Claude Code terminal via the relay command. History persisted in localStorage. |
| **Insights** | AI coaching report cards with letter grades (A–F) across eight dimensions — Planning, Precision, Tools, Context, Cost, Verification, Strategy, Configuration. Radar chart visualization. Playbook templates categorized by task type (feature, bugfix, refactor, test, review, debug). Budget tracker with spending alerts. |
| **Live Nudges** | Real-time coaching powered by 30+ modular rules. Nudges fire as you work — "high token churn detected," "consider batching these reads," "that prompt could be more specific." Sensitivity controls (low/medium/high). Per-rule enable/disable, severity overrides, cooldown tuning. Cross-session trend analysis (habits, improvements, regressions, personal bests). |

### Prompt Lab

Press **W** from the graph view to open the Prompt Lab modal — a quick-access version of the Workshop tab. Draft a prompt, pick a model, get AI scoring and rewrites, then send the result to your Claude Code terminal without switching tabs.

### Export

Multi-format export from the analytics page — HTML reports, CSV spreadsheets, or raw JSON. Choose which sections to include (overview, sessions, tools, models, turn details).

---

## Getting Started

### Prerequisites
- **VS Code** 1.95+
- **Node.js** 20+ (Claude Code requires this anyway)
- **Claude Code** installed (for live hook events — works with simulated data too)

### Installation

**VS Code** — from `.vsix` file:
```
code --install-extension synapse-vscode-0.2.0.vsix
```

**Cursor** — from `.vsix` file:
```
cursor --install-extension synapse-vscode-0.2.0.vsix
```
Or: open Cursor → Extensions sidebar → `···` menu → **Install from VSIX...** → select the file.

**From source:**
```
cd apps/vscode
pnpm run build
pnpm run package
code --install-extension synapse-vscode-0.2.0.vsix
```

### Usage

1. Open any project that has a `.claude/settings.json` or `.claude/settings.local.json`
2. Synapse auto-starts (see the `$(pulse)` icon in the activity bar)
3. The dashboard opens automatically — start a Claude Code session and watch the graph light up

If you don't have a live session, the extension still works — you can browse historical events stored in the embedded database.

---

## Keyboard Shortcuts

| Key       | Action                          |
|-----------|---------------------------------|
| **Space** | Pause/resume live updates       |
| **T**     | Toggle tool log panel           |
| **V**     | Lock viewport                   |
| **F**     | Toggle tool expansion           |
| **H**     | Toggle hook event visibility    |
| **C**     | Collapse prompts                |
| **N**     | Open spawn agent dialog         |
| **W**     | Open Prompt Lab                 |
| **E**     | Export snapshot                  |
| **I**     | Import snapshot                  |
| **/**     | Focus graph search              |
| **1–6**  | Switch lens tab                 |
| **Escape**| Close panels and dialogs        |

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
| **Synapse: Send Text to Claude Terminal** | Relay text from the Prompt Lab to a Claude Code terminal |

---

## Settings

Configure via VS Code Settings (`Ctrl+,`):

| Setting | Default | Description |
|---------|---------|-------------|
| `synapse.port` | `4000` | Preferred port. Auto-finds next available if busy. |
| `synapse.autoStart` | `true` | Start server automatically when opening a Claude project |
| `synapse.layout` | `split` | `split`: sidebar + editor panel. `single`: full dashboard in one panel. |

Additional settings (hooks, server control, AI features, session management) are in the custom settings panel — click the gear icon in the Synapse sidebar or run **Synapse: Settings** from the Command Palette.

Set the `SYNAPSE_MAX_EVENTS` environment variable to limit stored events in the database (default: unlimited).

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

## Cursor Compatibility

Synapse works in **Cursor** with no modifications — it uses standard VS Code extension APIs (WebviewView, TreeDataProvider, commands, configuration) that Cursor supports natively.

**What works identically:**
- Dashboard webview, sidebar lens panel, graph editor tab
- Embedded server auto-start and auto-stop
- Settings panel, all commands, keyboard shortcut forwarding
- WebSocket streaming, Explorer tree, status bar
- Analytics page, Prompt Lab, coaching nudges

**One thing to know:**
Hook events come from **Claude Code** (the CLI tool), not from Cursor's built-in AI. You need Claude Code installed and running in your project for live hook events. The extension activates when it sees `.claude/settings.json` in the workspace — this file is created by Claude Code. Without it, you can still use Synapse with simulated data or historical events from the embedded database.

**Upgrading in Cursor:**
Same as VS Code — install the new `.vsix` over the old one. Your database and settings are preserved.

---

## Known Limitations

Let's be honest:

- **No authentication** — The embedded server listens on localhost only. Don't port-forward it to the internet unless you enjoy surprise visitors.
- **Node.js required** — The extension spawns a Node.js process for the server. If Node isn't on your PATH, Synapse will politely tell you to install it and offer a download link.
- **AI features need an API key** — Prompt analysis, coaching summaries, and the Prompt Lab call the Anthropic API. Without a key configured in settings, those features degrade gracefully to rule-based analysis. Your prompts are sent to the API for scoring — don't use the AI features on classified material.
- **Windows-first development** — Built and tested primarily on Windows. Works on macOS and Linux, but if you find a platform-specific issue, we want to hear about it.
---

## Links

- [Report an issue](mailto:synapse@soarcer.dev) — We catalogued 104+ known issues ourselves. Yours might be new. That's exciting.

---

<p align="center">
  <sub>Built with curiosity, caffeine, and a mass amount of Claude.</sub>
  <br />
  <sub>~1.5 MB of "what is my AI doing right now" energy, packaged for your editor.</sub>
</p>
