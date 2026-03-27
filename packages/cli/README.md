# Synapse

Real-time agent observability for Claude Code. See what your agents are actually doing instead of staring at a blinking cursor.

<!-- 📸 HERO: Dashboard screenshot or GIF showing a live agent tree -->
<!-- ![Synapse dashboard](https://github.com/Soarcer/synapse/raw/main/docs/assets/hero-screenshot.png) -->

## Install

```bash
npm install -g @synapse-ai/cli
```

Requires Node.js 20+. That's it. You now have the `synapse` command.

## Quick Start

```bash
cd ~/your-project
synapse start
```

Three things happen:

1. The Synapse server starts on your machine
2. Claude Code hooks are configured for this project
3. The dashboard opens in your browser

Now run Claude Code like normal. Every agent spawn, tool call, and token gets captured and rendered as an interactive node graph in real-time. You'll wonder how you worked without it. (You worked fine. But you didn't _know_ what was happening. Now you do.)

Don't want to install globally? `npx @synapse-ai/cli start` works too.

<!-- 📸 GIF: Agent tree expanding as Claude works — nodes appearing, edges animating -->
<!-- ![Live agent graph](https://github.com/Soarcer/synapse/raw/main/docs/assets/graph-animation.gif) -->

## What You Get

- **Live node graph** — Sessions, agents, subagents, and tool calls as connected nodes with animated edges. Color-coded by status. Auto-expanding as agents spawn.
- **Five analysis lenses** — Same data, five perspectives: tree explorer, treemap, sankey flow, compaction forensics, cost waterfall. Click a node in any lens, it highlights in the graph.
- **Tool call grouping** — An agent that calls 47 tools doesn't produce 47 nodes. Three display modes: pill grid, timeline swimlanes, density heatmap.
- **Remote approval** — Start a job, walk away, approve permissions from your phone. Requires `--lan` mode. See [Security](#security).
- **Mobile PWA** — Pin to your home screen. 13 purpose-built mobile components. Pinch-zoom on the graph. It's not a responsive afterthought.
- **Cost tracking** — Per-turn USD breakdown by input, output, and cache tokens. The "was that refactor $0.03 or $3.00" view.

## Commands

| Command            | What it does                               |
| ------------------ | ------------------------------------------ |
| `synapse start`    | Start server (Ctrl+C to stop)              |
| `synapse start -d` | Start as background daemon                 |
| `synapse stop`     | Stop the server                            |
| `synapse status`   | Show URL, PID, and hook status             |
| `synapse open`     | Open dashboard in your browser             |
| `synapse hook`     | Hook current project to the running server |
| `synapse unhook`   | Remove hooks from current project          |
| `synapse help`     | Show all options                           |

### Start Options

```bash
synapse start -d              # Background daemon (recommended)
synapse start --lan           # LAN-accessible (mobile approval)
synapse start --observe-only  # Monitor only — no permission interception
synapse start --port 9000     # Custom port
synapse start --no-open       # Don't open browser
synapse start --no-hook       # Server only, no hook configuration
```

## Multi-Project Setup

The server is global — start it once, then hook as many projects as you want:

```bash
synapse start -d                        # Start once
cd ~/project-a && synapse hook          # Hook project A
cd ~/project-b && synapse hook          # Hook project B
synapse open                            # Dashboard shows everything
```

## Remote Approval

When Claude Code needs permission (Bash, Edit, etc.), the request appears on the dashboard. Approve or deny from any browser — including your phone on the same Wi-Fi.

The `PermissionRequest` hook holds Claude's request open until you respond. All other hooks are async and never block Claude.

```bash
synapse start -d --lan        # Required — makes the server reachable from your phone
synapse start --observe-only  # Or skip approval entirely — just watch the graph
```

## Security

By default, the server binds to **localhost only**. Nothing leaves your machine.

Pass `--lan` to enable remote approval from other devices on your network. This opens unauthenticated HTTP endpoints — anyone on your Wi-Fi can see and respond to permission requests. Great on your home network. Less great at a coffee shop.

**If you just want the graph without the security surface:** use `--observe-only`. The permission hook doesn't even start. All visualization, no attack surface.

For the full security model, see the [main README](https://github.com/Soarcer/synapse#security-model).

## Troubleshooting

**Claude Code hangs on every prompt:**
The server is not running but hooks are still configured. Either start the server (`synapse start -d`) or remove the hooks (`synapse unhook`).

**Events not appearing:**
Run `synapse status` to check hook status. Re-run `synapse hook` if needed.

**Port already in use:**
`synapse start --port 9000` — pick a different one.

## Links

- [GitHub](https://github.com/Soarcer/synapse) — source code, screenshots, full documentation
- [Security Model](https://github.com/Soarcer/synapse#security-model) — what's exposed and how to lock it down

## License

MIT

---

<sub>Built with curiosity, caffeine, and a mass amount of Claude.</sub>
