<p align="center">
  <br />
  <code>&nbsp;S Y N A P S E&nbsp;</code>
  <br />
  <strong>Real-time agent observability for Claude Code</strong>
  <br />
  <em>Because your AI is doing a lot of things. You should probably see what.</em>
  <br />
  <br />
  <a href="#the-graph">The Graph</a> &bull;
  <a href="#six-lenses">Six Lenses</a> &bull;
  <a href="#prompt-lab">Prompt Lab</a> &bull;
  <a href="#8--mobile--remote-approval">Mobile</a> &bull;
  <a href="#getting-started">Getting Started</a>
  <br />
  <br />
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/Soarcer.synapse-vscode)](https://marketplace.visualstudio.com/items?itemName=Soarcer.synapse-vscode)
[![Tests](https://img.shields.io/badge/tests-591_passing-brightgreen)](.)
[![Bundle](https://img.shields.io/badge/vsix-1.5_MB-blue)](.)

---

## What Is This?

Claude Code spawns subagents. Those subagents call tools. Those tools spawn _more_ agents — and the whole tree of computation happens behind a blinking cursor in your terminal. I wanted to see what was actually going on in there.

So I built Synapse. It started as a weekend hack to visualize hook events and turned into... this.

**Synapse is a real-time visual dashboard** that renders your entire Claude Code session as an interactive node graph. Every agent spawn, every tool call, every token — captured, visualized, and explorable. It runs as a **VS Code extension** with an embedded server, as a **standalone CLI** (`pnpm dev`) for console-only workflows, or as a **mobile PWA** you can pin to your phone and approve permissions from while making coffee. All three modes connect to the same backend — use whichever fits how you work.

<!-- HERO SCREENSHOT: Full dashboard showing a complex agent tree with animated edges, lens panel open on the left, detail panel on the right -->
<!-- ![Synapse dashboard](docs/assets/hero-screenshot.png) -->

> **Status:** Prototype with opinions. 591 tests. 10 completed development phases. Some edges are load-bearing. I'm proud of it anyway.

---

## 11 Things That Might Be Interesting

I'm not sure which of these are genuinely novel and which are "obvious in retrospect," but here's what I think is worth looking at:

### 1. Live Node Graph with Animated Data Flow

The core visualization — and the first thing you see. Sessions, agents, subagents, and tool calls rendered as connected nodes with animated smooth-step edges showing data flowing through the agent tree. New nodes animate into position as agents spawn. Color-coded by status — green running, red error, purple task agent, orange context compaction. Custom tree layout algorithm (we replaced dagre — long story) that handles arbitrarily deep hierarchies without overlapping.

<!-- GIF: Agent tree expanding in real-time as Claude works — nodes appearing, edges animating, status colors changing -->
<!-- ![Live graph animation](docs/assets/graph-animation.gif) -->

### 2. Deep Node Drill-Down

Click any node in the graph. The detail panel shows everything: streaming text output, full tool call history with inputs and outputs, token counts, elapsed time, cost estimate, agent hierarchy path, and status timeline. For tool groups, expand to see individual calls with duration bars. For sessions, see the full prompt history with complexity scoring.

<!-- GIF: Clicking a node, detail panel sliding open, expanding tool history, drilling into a specific tool call -->
<!-- ![Node drill-down](docs/assets/node-drilldown.gif) -->

### 3. Six Bidirectionally-Linked Lens Views

Same data. Six perspectives. Click a node in any lens, it highlights in the graph. Click a node in the graph, it highlights in every lens. All derived from the same tree structure — one source of truth.

| Lens           | What It Shows                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Tree**       | Hierarchical explorer. Sessions → Prompts → Agents → Tools. Consecutive identical calls auto-grouped (`Read x14`).                |
| **Heatmap**    | Activity density. Tools on Y-axis, time on X-axis, color intensity = call count or token usage.                                   |
| **Treemap**    | Proportional resource usage. Rectangle area = tokens, duration, or count. Drill into any agent.                                   |
| **Sankey**     | Flow diagram. Four layers showing how resources flow through the agent tree. Prettiest lens. Least functional. We keep it anyway. |
| **Compaction** | Context window forensics. Sawtooth sparkline showing when Claude forgot what you said, and why.                                   |
| **Cost**       | Per-turn USD waterfall. Input, output, cache tokens, model used, latency, running total.                                          |

<!-- SCREENSHOT GRID: 2x3 grid showing all six lens views with the same session data -->
<!-- ![Six lens views](docs/assets/lens-grid.png) -->

### 4. Tool Call Grouping (Three Visualization Modes)

An agent that calls 47 tools used to produce 47 nodes. Now they're grouped into composite nodes with three display modes:

| Mode          | Shows                                                                            |
| ------------- | -------------------------------------------------------------------------------- |
| **Pill Grid** | Color-coded pills — tool name, count badge, status dot. Compact overview.        |
| **Timeline**  | Chronological swimlanes — which tools ran when, how long each took.              |
| **Heatmap**   | Density grid — color intensity = call frequency. Spot the hot tools at a glance. |

Toggle between collapsed chips and expanded detail with **F**. The underlying data stays the same — individual tools in the store, composite nodes rendered at display time. (And if you happen to try a few classic input sequences while hovering over a tool group... well, we can neither confirm nor deny.)

<!-- GIF: Toggling between the three tool group modes on the same node -->
<!-- ![Tool group modes](docs/assets/tool-groups.gif) -->

### 5. Prompt Lab — Save Tokens, Save Money

Press **W** to open the Prompt Lab. Write a draft prompt, pick a model (Haiku/Sonnet/Opus), choose analysis mode (Developer for technical feedback, Vibe for casual coaching), and get real-time scoring with rewrite suggestions. When you're happy with it, relay the improved prompt directly to your Claude Code terminal.

The idea is simple: a better prompt means fewer wasted tokens, fewer confused agent loops, and less money burned on round-trips that could've been one shot. Draft it, refine it, send it — without context-switching out of the dashboard.

> **Note:** AI-powered prompt analysis requires an Anthropic API key configured in settings. We're investigating whether the Prompt Lab can piggyback on an existing Claude Max/Pro subscription instead — stay tuned.

<!-- SCREENSHOT: Prompt Lab modal with a scored prompt, rewrite suggestion, and "Send to Terminal" button -->
<!-- ![Prompt Lab](docs/assets/prompt-lab.png) -->

### 6. Compaction Forensics

Ever had Claude forget something you told it 10 minutes ago? The Compaction lens shows exactly when the context window hit its limit, with a sparkline of cumulative input tokens over time. Red dashed lines mark compaction events. The sawtooth pattern is your forensic evidence. Per-turn breakdown table shows which prompt triggered each compaction and what it cost.

<!-- SCREENSHOT: Compaction lens showing sawtooth pattern with compaction markers -->
<!-- ![Compaction forensics](docs/assets/compaction-lens.png) -->

### 7. Cost Tracking Per Turn

Every turn gets a cost estimate broken down by input, output, cache read, and cache creation tokens. Cumulative waterfall so you know whether that "simple refactor" cost $0.03 or $3.00. Model badges show which Claude model handled each turn. The Cost lens is your "am I spending what I think I'm spending" view.

<!-- SCREENSHOT: Cost lens showing per-turn waterfall with model badges and running total -->
<!-- ![Cost tracking](docs/assets/cost-lens.png) -->

### 8. Mobile + Remote Approval

The dashboard is a full Progressive Web App — pin it to your home screen and it works like a native app. Auto-detects phones and switches to a mobile-optimized layout with 13 purpose-built components: bottom tab bar, swipe-up detail sheets, pinch-zoom graph, session selector.

But the real reason for mobile: **remote approval**. Start a big job on your laptop, walk away, and your phone buzzes when Claude is blocked on a permission. Swipe to approve. Job continues. You never opened your laptop. Claude Code's HTTP hooks hold the response open until you tap Approve or Deny from any device. Cards stack with countdown timers, and you can swipe-cycle through multiple pending requests.

And you don't even need the dashboard open — Synapse registers a Service Worker and sends **native push notifications** when Claude is blocked. On Android you get Approve/Deny action buttons right in the notification. On iOS you tap to open. Works with the app completely closed.

<!-- GIF: Phone showing permission card with countdown, user tapping Approve, then showing the graph resuming -->
<!-- ![Mobile + remote approval](docs/assets/remote-approval.gif) -->

### 9. Multi-Vendor Support (In Progress)

The adapter architecture is built and Claude Code is fully working. Gemini CLI and Codex CLI adapters are in progress — the plumbing is there (adapter interface, registry, vendor detection, session namespacing) but they haven't been battle-tested yet. The goal: monitor any AI coding agent from one dashboard, regardless of vendor.

### 10. Guided Tour

First-time visitors get an interactive onboarding walkthrough — spotlight highlights, narration cards, step-by-step through the graph, lenses, panels, and settings. Six chapters, 18+ steps.

### 11. Two Ways to Run It

Synapse works as a **VS Code extension** or as a **standalone CLI** — and they complement each other.

**VS Code extension:** The full stack — server, dashboard, hook scripts, SQLite — bundles into a `.vsix` with zero native dependencies. Auto-starts when you open a Claude project, auto-stops when VS Code closes. Split layout (lens sidebar + graph editor) or single panel. Works identically in Cursor.

**CLI:** `synapse start` boots the server, auto-configures your hooks, and opens the dashboard in your browser. Background daemon mode (`--bg`) keeps it running across terminal sessions. `synapse stop` shuts it down. Good for Claude Code console users, multi-monitor setups, or when you want the graph on a separate screen.

Both modes connect to the same backend. Use the extension for integrated development, the CLI for flexibility, or both at once.

<!-- SCREENSHOT: VS Code with Synapse split layout — lens sidebar on left, graph in editor panel -->
<!-- ![VS Code extension](docs/assets/vscode-extension.png) -->

---

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                  FRONTEND (React + Vite)                 │
│                                                         │
│   ┌──────────────┐  ┌──────────┐  ┌─────────────────┐  │
│   │  React Flow   │  │  Detail   │  │  Tool Log       │  │
│   │  Node Graph   │  │  Panels   │  │  Timeline       │  │
│   └──────┬───────┘  └────┬─────┘  └────────┬────────┘  │
│          └────────────────┴─────────────────┘           │
│                          │ WebSocket                     │
└──────────────────────────┼──────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────┐
│                  BACKEND (Express + SQLite)               │
│                                                          │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│   │ Hook Receiver │  │ Permission   │  │  WebSocket   │  │
│   │ POST /events  │  │ Server :27247│  │  Broadcaster │  │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│          └──────────────────┴─────────────────┘          │
│                     Event Store (sql.js)                  │
└──────────────────────────────────────────────────────────┘
         ▲                    ▲               │
         │ HTTP POST          │ HTTP Hook     │ Agent SDK
         │                    │ (waits)       ▼
┌────────┴───────────┐  ┌────┴──────────┐  ┌──────────────┐
│  Claude Code Hooks  │  │  Permission   │  │  Spawned     │
│  (your sessions)    │  │  Requests     │  │  Agents      │
└────────────────────┘  └───────────────┘  └──────────────┘
```

**The short version:**

1. You run Claude Code like normal. Hook scripts silently capture events and POST them to Synapse.
2. The backend normalizes, stores (SQLite), and broadcasts over WebSocket.
3. The frontend renders everything as an interactive node graph in real-time.
4. When Claude needs permission, a separate HTTP hook holds the request open until you approve from any device.

---

## Features At a Glance

### The Graph

- **Interactive node graph** — Sessions, agents, subagents, tool calls as connected nodes with animated edges
- **Custom tree layout** — Purpose-built algorithm that handles arbitrarily deep hierarchies without overlap
- **Color-coded status** — Green = running, gray = done, red = error, purple = task agent, orange = compaction
- **Auto-expanding** — New nodes animate into position as agents spawn
- **Streaming preview** — Live agent output shown on node hover

### Remote Approval + Mobile

- **Permission cards** — Draggable card stack with countdown timers and swipe cycling
- **Multi-question forms** — AskUserQuestion cards with tab bar, multi-select, and answer tracking
- **Deny with message** — Add context when denying so Claude knows why
- **Web Push** — Native phone notifications even with the app closed
- **Progressive Web App** — Pin to home screen, 13 mobile-optimized components, QR code setup

### Observability

- **Real-time streaming** — WebSocket, not polling. Events appear as they happen.
- **Full event history** — Everything persisted to SQLite. Filter by session, agent, type.
- **Token tracking** — Input/output/cache tokens per agent, per session, per turn
- **Tool call timeline** — Chronological log with duration, status, input/output inspection
- **Session snapshots** — Export/import full graph state as JSON. Share with your team.

### Analytics (Work in Progress)

| Tab          | What It Does                                                                        |
| ------------ | ----------------------------------------------------------------------------------- |
| **Prompts**  | Complexity scoring, cost scatter plots, AI-powered scoring with rewrite suggestions |
| **Insights** | Usage patterns, tool distribution, session trends. More tabs coming.                |

### Control

- **Spawn agents** — Pick model, tools, permissions, write a prompt, watch it work live
- **Send messages** — Interactive conversation with spawned agents
- **Stop agents** — Kill any agent from the graph or detail panel
- **Pause/resume** — Freeze the stream without losing events

---

## Keyboard Shortcuts

| Key        | Action                    | Key     | Action                |
| ---------- | ------------------------- | ------- | --------------------- |
| **Space**  | Pause/resume live updates | **/**   | Focus graph search    |
| **T**      | Toggle tool log panel     | **L**   | Toggle lens panel     |
| **N**      | Open spawn agent dialog   | **1–6** | Switch lens tab       |
| **W**      | Open Prompt Lab           | **E**   | Export snapshot       |
| **V**      | Lock viewport             | **I**   | Import snapshot       |
| **F**      | Toggle tool expansion     | **A**   | Toggle notifications  |
| **H**      | Toggle hook events        | **C**   | Auto-collapse prompts |
| **Escape** | Close panels and dialogs  |         |                       |

---

## Getting Started

Three ways to run Synapse, from simplest to most involved:

### 1. CLI (Quickest)

```bash
npm install -g @synapse-ai/cli
synapse start          # starts server, configures hooks, opens dashboard
```

That's it. Synapse auto-detects your project, wires up the hooks, starts the server, and opens your browser. Run `synapse stop` when you're done, or `synapse status` to check on it. Background mode with `synapse start --bg` for daemon operation.

> **Note:** Not yet published to npm — coming soon. For now, build from source (option 3) or use the VS Code extension.

### 2. VS Code Extension

```bash
code --install-extension synapse-vscode-0.2.0.vsix
```

Or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Soarcer.synapse-vscode). The full stack — server, dashboard, hook scripts, SQLite — bundled into a `.vsix` with zero native dependencies. Also works in Cursor.

<!-- SCREENSHOT: VS Code with Synapse — lens sidebar, graph editor, status bar -->
<!-- ![VS Code extension](docs/assets/vscode-split.png) -->

- **Auto-start** — Opens when you open a Claude project. Stops when VS Code closes.
- **Split layout** — Lens sidebar + graph editor panel. Or single panel mode.
- **11 commands** — Open Dashboard, Start/Stop Server, Configure Hooks, Switch Lens, Reconnect, Settings, Send to Terminal, Clear/Reload Events
- **QR code panel** — Scan to connect your phone
- **Explorer tree** — Session → Agent → Tool hierarchy in the sidebar
- **Status bar** — Connection dot, agent count, tool count

### 3. From Source

```bash
git clone https://github.com/anthropics/synapse.git
cd synapse
pnpm install
pnpm dev  # starts backend (port 27246) + frontend (port 5173)
```

Open **http://localhost:5173**. Requires Node.js >= 20 and pnpm >= 9.

### Connecting Claude Code

If you're running Claude Code in this project, it's already wired up. The `.claude/settings.json` configures hooks that send events to the dashboard automatically.

For other projects, copy the hook configuration:

```bash
# Copy hooks/ directory and .claude/settings.json to your target project
# Update command paths to point to this project's hooks/send_event.cjs
```

### Try It Without Claude

```bash
# Basic simulation — 8 events (session, agents, tools)
npx tsx scripts/simulate_session.ts

# Full demo — 31 events covering every node type
npx tsx scripts/simulate_all_nodes.ts
```

---

## Tech Stack

| Layer         | Technology                                                     |
| ------------- | -------------------------------------------------------------- |
| **Frontend**  | React 19, React Flow v12, Zustand 5, Tailwind CSS 4, Vite 6    |
| **Backend**   | Express 5, WebSocket (ws 8), sql.js (pure JS SQLite), Node 20+ |
| **Agent SDK** | @anthropic-ai/claude-agent-sdk                                 |
| **Language**  | TypeScript 5.7 throughout                                      |
| **Testing**   | Vitest 4 — 591 tests                                           |
| **Monorepo**  | pnpm workspaces (@synapse-ai/\*)                               |
| **Linting**   | ESLint 9, Prettier 3, Husky + lint-staged                      |

---

## Project Structure

```
Synapse/
├── packages/
│   ├── core/             # @synapse-ai/core — types, Zod schemas, format utils
│   └── server/           # @synapse-ai/server — Express + sql.js + WebSocket
├── apps/
│   ├── dashboard/        # React 19 + React Flow v12 frontend
│   └── vscode/           # VS Code extension (embedded dashboard)
├── hooks/                # Claude Code hook scripts (zero dependencies)
├── scripts/              # Build, simulation, and utility scripts
└── docs/                 # Architecture, plans, and specs
```

---

## API

### Events

```
POST /api/events                    # Receive hook events
GET  /api/events?sessionId=X&limit=100  # Query history
```

### Agents

```
GET    /api/agents                  # List active agents
POST   /api/agents/spawn            # Spawn new agent
POST   /api/agents/:id/message      # Send message
DELETE /api/agents/:id              # Stop agent
GET    /api/agents/:id/transcript   # Get transcript
```

### Permissions

```
GET  /api/permissions               # List pending permissions
GET  /api/permissions/:id           # Get full permission detail
POST /api/permissions/:id/respond   # Approve or deny
```

### Analytics

```
GET /api/analytics/overview         # KPI summary
GET /api/analytics/sessions         # Session breakdown
GET /api/analytics/tools            # Tool usage stats
GET /api/analytics/models           # Model comparison
GET /api/analytics/turns            # Per-turn detail
GET /api/analytics/velocity         # Tokens/min, cost/min
GET /api/analytics/budget           # Budget tracking
```

### WebSocket

```
WS /ws                              # Real-time event stream
```

---

## Configuration

| Variable             | Default   | Description                              |
| -------------------- | --------- | ---------------------------------------- |
| `ANTHROPIC_API_KEY`  | —         | Spawning agents + Prompt Lab AI analysis |
| `PORT`               | `27246`   | Main server port                         |
| `SYNAPSE_MAX_EVENTS` | unlimited | Cap stored events                        |

The database lives at `packages/server/synapse.db` (auto-created, gitignored). Delete it to start fresh.

---

## Known Limitations

Let's be honest with each other:

- **No authentication** — Localhost only. Don't port-forward this unless you enjoy surprise visitors.
- **WebSocket reconnect is loyal** — If the server goes down, the client will try to reconnect. Forever. With exponential backoff. But also forever.
- **Memory at scale** — Long sessions with thousands of events accumulate in the Zustand store. If your agent tree looks like a fractal, refresh.
- **Windows-first** — Built on Windows, start scripts are PowerShell. `pnpm dev` works everywhere.
- **AI features need an API key** — Prompt Lab analysis and rewrite suggestions call the Anthropic API. Without a key, those degrade gracefully to rule-based analysis. We're exploring whether existing Claude subscriptions can be used instead.

---

## Roadmap

What's done and what's next:

| Phase                | Status | Description                                         |
| -------------------- | ------ | --------------------------------------------------- |
| Hardening            | Done   | Error boundaries, rate limiting, agent limits       |
| Developer Experience | Done   | ESLint, Prettier, Vitest, Husky, CI/CD              |
| Monorepo             | Done   | 5 packages, pnpm workspaces, @synapse-ai/\*         |
| Performance + UX     | Done   | Async I/O, react-virtuoso, URL deep linking         |
| Mobile Responsive    | Done   | 13 components, auto-detect, pinch zoom              |
| Notifications        | Done   | Toast tray, push subscriptions, Service Worker      |
| Guided Tour          | Done   | Auto-play demo + spotlight walkthrough              |
| VS Code Extension    | Done   | v0.9.0 — 11 commands, split layout, embedded server |
| Analytics + Cost     | WIP    | Prompts + Insights tabs. More coming                |
| Multi-Vendor         | WIP    | Claude working. Gemini + Codex adapters in progress |
| Remote Approval      | Done   | HTTP hooks, permission cards, web push              |
| Standalone CLI       | Next   | `npx synapse` — zero-config, daemon mode            |

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and code style.

---

## The Story

I built this because I was curious. Claude Code does a _lot_ of things when you're not looking — spawning subagents, calling tools, reading files, making decisions — and all you see is a blinking cursor. I wanted to see the machine think.

It started as a script that logged hook events to a terminal. Then I added a web UI. Then a node graph. Then I wanted to see the graph on my phone. Then I wanted to approve permissions from my phone. Then I wanted coaching on my prompts. Then I added arcade games because why not.

Ten development phases later, here we are. It's a prototype. It has rough edges. Some of those edges turned out to be features. I've been using it every day while building it — which means it's been tested in production — where "production" is defined as "my laptop at 2 AM."

If you're the kind of person who reads this far in a README, you're probably also the kind of person who wants to understand the machine. Not because you don't trust it, but because understanding is its own reward.

Also, it looks really cool. Let's not pretend that wasn't a factor.

---

## License

MIT — see [LICENSE](./LICENSE)

---

<p align="center">
  <sub>Built with curiosity, caffeine, and an mass amount of Claude.</sub>
  <br />
  <sub>If you're reading this, an AI agent might be watching you read this. <em>Check the graph.</em></sub>
</p>
