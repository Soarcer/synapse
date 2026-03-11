<p align="center">
  <br />
  <code>&nbsp;S Y N A P S E&nbsp;</code>
  <br />
  <strong>Real-time agent observability for Claude Code</strong>
  <br />
  <em>Because your AI is doing a lot of things. You should probably see what.</em>
  <br />
  <br />
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#how-it-works">How It Works</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#tech-stack">Tech Stack</a> &bull;
  <a href="#contributing">Contributing</a>
  <br />
  <br />
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/Soarcer.synapse-vscode)](https://marketplace.visualstudio.com/items?itemName=Soarcer.synapse-vscode)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen)](https://github.com/anthropics/synapse/actions)

---

## What Is This?

Synapse is a **visual, real-time dashboard** that lets you watch Claude agents think, plan, spawn subagents, call tools, and stream responses — all rendered as an interactive node graph you can zoom, pan, click, and actually _understand_.

Think of it as a flight control tower for AI agents. Except the planes are writing code, the runway is your filesystem, and sometimes they spawn smaller planes mid-flight. It's fine. Everything is fine. You can see it all now.

It works in two modes:

1. **Observer mode** — Hook into any running Claude Code session. Every tool call, every subagent spawn, every session lifecycle event gets captured and visualized in real-time. Zero changes to your workflow. Just plug in and watch.

2. **Operator mode** — Spawn, control, and stream custom agents directly from the dashboard. Pick a model, set tools and permissions, write a prompt, and watch the agent work — live, in the graph.

> **Status:** This is a prototype. It was born out of genuine curiosity about what Claude agents _actually do_ when you're not looking. It works. It has rough edges. Some of those edges are load-bearing. We're proud of it anyway.

---

## Screenshots

> **Note:** Screenshots will be added before the v0.1.0 tag. Run `pnpm dev` then `npx tsx scripts/simulate_session.ts` to see the dashboard in action.

<!-- TODO: Add real screenshots before tagging v0.1.0
![Agent graph showing Claude session in progress](docs/assets/screenshot-graph.png)
![Lens panel showing analytics and cost breakdown](docs/assets/screenshot-lens.png)
-->

_Screenshots coming soon. For now, imagine a dark-themed node graph with glowing edges, animated data flow particles, and the quiet satisfaction of finally seeing what your AI is up to._

---

## Why Synapse Exists

Modern AI agents are remarkably capable and remarkably opaque. Claude Code can spawn subagents, those subagents can call tools, those tools can spawn _more_ agents — and the whole tree of computation happens behind a blinking cursor in your terminal.

That's a lot of trust. Synapse is what happens when trust meets curiosity.

We wanted to answer questions like:

- How deep does the agent tree actually go?
- Which tools get called the most? Which ones fail?
- How much does a "simple" refactor actually cost in tokens?
- What is the Explore agent doing for 45 seconds before it responds?
- Wait, it spawned _how many_ subagents?

If you've ever stared at a Claude Code session and thought "I wonder what's happening in there" — this is your window.

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
│   │ Hook Receiver │  │ Agent SDK    │  │  WebSocket   │  │
│   │ POST /events  │  │ Manager      │  │  Broadcaster │  │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│          └──────────────────┴─────────────────┘          │
│                     Event Store (SQLite)                  │
└──────────────────────────────────────────────────────────┘
         ▲                              │
         │ HTTP POST                    │ Agent SDK
         │                              ▼
┌────────┴───────────┐      ┌─────────────────────┐
│  Claude Code Hooks  │      │  Spawned Agents     │
│  (your sessions)    │      │  (from dashboard)   │
└────────────────────┘      └─────────────────────┘
```

**The short version:**

1. You run Claude Code like normal. Hook scripts silently capture events (agent spawns, tool calls, session lifecycle) and POST them to the Synapse backend.
2. The backend normalizes events, stores them in SQLite, and broadcasts them over WebSocket.
3. The frontend receives events in real-time and renders them as an interactive node graph — sessions at the root, agents branching off, tool calls as leaves, all connected by animated edges.
4. Click any node to inspect it. Spawn new agents from the dashboard. Pause the stream. Filter by session. Watch the token counter go up and question your life choices.

---

## Features

### The Graph

- **Interactive node graph** — Sessions, agents, subagents, and tool calls as connected nodes
- **Custom tree layout** — Purpose-built layout algorithm (we replaced dagre, long story) that handles deep agent hierarchies without overlapping
- **Animated edges** — Smooth-step edges with animated particles showing data flow direction
- **Color-coded status** — Green = running, gray = done, red = error, purple = tool active. You get the idea.
- **Auto-expanding** — New nodes animate into position as agents spawn and tools fire

### Observability

- **Real-time streaming** — Events appear as they happen, not after. WebSocket, not polling.
- **Full event history** — Every event persisted to SQLite. Filter by session, agent, event type.
- **Token tracking** — Input/output token counts per agent, per session
- **Tool call timeline** — Chronological log with duration, status, and input/output inspection
- **Agent detail panel** — Streaming text output, tool history, status, elapsed time

### Control

- **Spawn agents from the dashboard** — Pick model, tools, permissions, write a prompt, hit go
- **Send messages to running agents** — Interactive conversation with spawned agents
- **Stop agents** — Kill any running agent from the graph or detail panel
- **Pause/resume** — Freeze the live stream without losing events

### Lens Panel — Six Ways to See Your Agents

The left sidebar isn't just a file tree. It's a switchable analysis panel with six different _lenses_ — each one a different way to slice the same underlying data. All lenses are bidirectionally linked to the main graph: click a node in a lens, and it highlights in the graph (and vice versa).

| Lens           | Tab Label | What It Shows                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tree**       | `Tree`    | Hierarchical explorer view of every session, prompt, agent, and tool call. Collapsible, searchable, filterable. Consecutive identical tool calls are auto-grouped (`Read x14` instead of 14 separate rows). This is your "what happened, structurally" view.                                                                                                                  |
| **Heatmap**    | `Heat`    | Activity heatmap — tools and agents on the Y-axis, time buckets on the X-axis, cell intensity = call count or token usage. Answers "when was this agent busy?" and "which tools dominate the session?" at a glance. Toggle between count and token coloring.                                                                                                                  |
| **Treemap**    | `TMap`    | Squarified treemap showing proportional resource usage. Each rectangle's area maps to tokens, duration, or call count (switchable metric). Drill into nested agents to see where compute actually went. Great for spotting that one Explore agent quietly burning 80% of your tokens.                                                                                         |
| **Sankey**     | `Flow`    | Flow diagram with four vertical layers: Sessions → Prompts → Agents → Tools. Band width = tokens, duration, or count flowing through each path. Reveals the actual topology of work — which prompts triggered which agents, which agents called which tools, and how resources flowed through the tree.                                                                       |
| **Compaction** | `Comp`    | Context compaction timeline. Shows when Claude's context window hit its limit and got compacted (auto or manual), with a sparkline of cumulative input tokens over time. The sawtooth pattern tells you how aggressively the session is chewing through context. If you've ever wondered "why did Claude forget what I said 10 minutes ago" — this is your forensic evidence. |
| **Cost**       | `Cost`    | Per-turn cost waterfall. Every user prompt gets a row showing input tokens, output tokens, cache read/creation tokens, model used, response latency, and estimated USD cost. Cumulative running total at the bottom. Supports both hook-sourced data and richer JSONL transcript data when available. This is the "am I spending $0.03 or $3.00 on this refactor" view.       |

All lenses share the same derived tree structure (built directly from the React Flow graph topology, not from timestamps), so the hierarchy you see in Tree is the same hierarchy powering Treemap, Sankey, and Heatmap. One source of truth, six perspectives.

### Keyboard Shortcuts

| Key        | Action                                                             |
| ---------- | ------------------------------------------------------------------ |
| **T**      | Toggle tool log panel                                              |
| **N**      | Open spawn agent dialog                                            |
| **Space**  | Pause/resume live updates                                          |
| **Escape** | Close panels and dialogs                                           |
| **L**      | Toggle layout mode (graph/list)                                    |
| **H**      | Toggle hook event visibility                                       |
| **V**      | Toggle lock viewport                                               |
| **F**      | Toggle show all tools                                              |
| **C**      | Toggle auto-close prompts                                          |
| **E**      | Export snapshot                                                    |
| **I**      | Import snapshot                                                    |
| **/**      | Focus graph search                                                 |
| **1–6**    | Switch lens tab (tree, heatmap, treemap, sankey, compaction, cost) |

---

## Quick Start

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9
- An **Anthropic API key** (for spawning agents from the dashboard)

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/synapse.git
cd synapse
pnpm install
```

Create a `.env` file in the project root:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

### Running

Open two terminals:

```powershell
# Terminal 1 — Backend (port 4000)
.\start-server.ps1

# Terminal 2 — Frontend (port 5173)
.\start-client.ps1
```

Or, if you like to live dangerously:

```bash
pnpm dev  # runs both concurrently (works great on Linux/Mac, "works" on Windows)
```

Then open **http://localhost:5173** in your browser.

### Connecting Claude Code

If you're running Claude Code in this project directory, it's already wired up. The `.claude/settings.json` file configures hooks that automatically send events to the dashboard.

For other projects, copy the hook configuration:

```bash
# Copy hooks/ directory and .claude/settings.json to your target project
# Update the command paths to point to this project's hooks/send_event.cjs
```

### Simulating a Session (No Claude Required)

Don't have a live Claude session? No problem:

```bash
npx tsx scripts/simulate_session.ts
```

This fires 8 realistic events (session start, agent spawn, tool calls, agent stop, session end) so you can see the dashboard in action without burning any API credits. Because we respect your wallet.

---

## Tech Stack

| Layer         | Technology                                           |
| ------------- | ---------------------------------------------------- |
| **Frontend**  | React 19, React Flow v12, Zustand 5, Tailwind CSS 4  |
| **Build**     | Vite 6, TypeScript 5.7                               |
| **Backend**   | Express 5, WebSocket (ws 8), sql.js (pure JS SQLite) |
| **Agent SDK** | @anthropic-ai/claude-agent-sdk                       |
| **Linting**   | ESLint 9, Prettier 3, Husky + lint-staged            |
| **Monorepo**  | pnpm workspaces                                      |
| **Testing**   | Vitest 4, 591 tests                                  |

---

## Project Structure

```
Synapse/
├── packages/
│   ├── core/             # @synapse-ai/core — types, schemas, utilities
│   ├── server/           # @synapse-ai/server — Express + SQLite + WebSocket
│   └── openclaw/         # @synapse-ai/openclaw — multi-vendor monitoring plugin
├── apps/
│   ├── dashboard/        # React 19 + React Flow v12 frontend
│   └── vscode/           # VS Code extension (embedded dashboard)
├── hooks/                # Claude Code hook scripts
├── scripts/              # Build, simulation, and utility scripts
└── docs/                 # Architecture and planning docs
```

---

## API Reference

### Hook Event Receiver

```
POST /api/events
```

Accepts raw hook JSON from Claude Code, normalizes it to an `AgentEvent`, stores it, and broadcasts via WebSocket.

### Agent Management

```
GET    /api/agents              # List active agents
POST   /api/agents/spawn        # Spawn new agent
POST   /api/agents/:id/message  # Send message to running agent
DELETE /api/agents/:id          # Stop agent
GET    /api/agents/:id/transcript  # Get agent transcript
```

### Event History

```
GET /api/events?sessionId=X&agentId=Y&type=Z&limit=100&offset=0
```

### WebSocket

```
WS /ws
```

Real-time event stream. Server pushes `AgentEvent` objects as they arrive. Supports session-level subscribe/unsubscribe.

---

## Configuration

| Variable            | Default | Description                                 |
| ------------------- | ------- | ------------------------------------------- |
| `ANTHROPIC_API_KEY` | —       | Required for spawning agents from dashboard |
| `PORT`              | `4000`  | Backend server port                         |
| `CORS_ORIGIN`       | `*`     | Allowed CORS origin (set in production!)    |

The backend stores events in `packages/server/synapse.db` (auto-created, gitignored). Delete it to start fresh.

---

## Integrations

### VSCode Extension

Synapse includes a VSCode extension that embeds the dashboard directly in your editor. See [apps/vscode/](apps/vscode/) for details.

### OpenClaw Plugin

An experimental integration with [OpenClaw](https://openclaw.dev) that bridges JSONL transcript files into the Synapse event stream. See [packages/openclaw/](packages/openclaw/) for the plugin source.

---

## Known Limitations

Let's be honest with each other. This is a prototype, and we're putting it on the internet:

- **No authentication** — The API is wide open. Don't expose this to the public internet unless you enjoy surprises.
- **Test coverage is growing** — 591 tests and counting, but some areas still need coverage.
- **WebSocket reconnect is... persistent** — If the server goes down, the client will try to reconnect. Forever. With exponential backoff. But also forever. It's loyal like that.
- **Memory considerations** — Long-running sessions with thousands of events will accumulate in the Zustand store. If your agent tree starts looking like a fractal, maybe refresh.
- **Windows-first** — Built on Windows, start scripts are PowerShell. Works on Linux/Mac with `pnpm dev`, but the convenience scripts need adaptation.

For the full audit (all 104+ known issues, lovingly catalogued), see [docs/INVESTIGATION_FINDINGS.md](docs/INVESTIGATION_FINDINGS.md). We believe in radical transparency. Also, we wrote the audit ourselves, which is either admirable or a cry for help.

---

## Roadmap

Things we want to build (pull requests extremely welcome):

- [ ] **MCP tool differentiation** `HIGH EFFORT` — Right now, all tool calls look the same in the graph. An MCP tool from your Notion server and a native `Read` call are both purple pills. This changes that. Colored left borders per MCP server (auto-generated from server name hash), badge chips showing the server name, a plug icon for MCP tools, provider info in the detail panel, and the Sankey lens gets an optional 5th layer (Sessions → Prompts → Agents → **MCP Servers** → Tools). Detection heuristic parses `mcp__<server>__<tool>` naming, cross-references against a known native tools list, and falls back gracefully. Touches ~15-20 files across types, backend, graph nodes, all 6 lenses, edges, and spawn dialog. Full design spec in [docs/MCP_TOOL_DIFFERENTIATION.md](docs/MCP_TOOL_DIFFERENTIATION.md). Implementation prompt for AI-assisted coding in [docs/PROMPT_MCP_IMPLEMENTATION.md](docs/PROMPT_MCP_IMPLEMENTATION.md).
- [ ] **Spawned agent detail panel** — When you spawn an agent from the dashboard, we _know_ its prompt, model, allowed tools, permission mode, system prompt, and working directory — but none of that shows up in the info bar. Fix the pipeline so `SpawnAgentRequest` fields flow through to `AgentNodeData` and render in the detail panel. Also: token costs from the SDK `ResultMessage` are conditionally skipped when `cost_usd` is null, so SDK-spawned agents often show 0 tokens even when they did real work.
- [ ] **Session recording & replay** — Record a session, replay it like a movie
- [ ] **Token cost dashboard** — Aggregate spending per session, per model, per tool
- [ ] **Agent diff view** — See what an agent changed in your codebase, visually
- [ ] **Multi-project support** — Monitor agents across multiple repos from one dashboard
- [ ] **Authentication** — Because eventually someone will ask
- [ ] **Expand test coverage** — 591 tests in place, but more areas need coverage
- [ ] **Performance profiling** — Flame graphs for agent execution trees
- [ ] **Export/share** — Export session graphs as images or interactive HTML

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and how to submit pull requests.

All contributions require a [Developer Certificate of Origin](https://developercertificate.org/) sign-off. See the contributing guide for details.

---

## The Philosophy

Synapse exists at an interesting moment. AI agents are getting more capable every week. They spawn subagents, call tools, read and write files, make decisions — and most of the time, we just see the final output.

That's probably fine for most use cases. But if you're the kind of person who reads this far in a README, you're probably also the kind of person who wants to _understand the machine_. Not because you don't trust it (though healthy skepticism never hurts), but because understanding is its own reward.

We built Synapse because watching an agent tree expand in real-time, seeing tool calls light up and data flow along edges, tracking tokens as they accumulate — it makes the invisible _visible_. And visibility is the first step toward understanding.

Also, it looks really cool. Let's not pretend that wasn't a factor.

---

## License

MIT — see [LICENSE](./LICENSE)

---

<p align="center">
  <sub>Built with curiosity, caffeine, and a mass amount of Claude.</sub>
  <br />
  <sub>Licensed under <a href="LICENSE">MIT</a>.</sub>
  <br />
  <sub>If you're reading this, an AI agent might be watching you read this. <em>Check the graph.</em></sub>
</p>
