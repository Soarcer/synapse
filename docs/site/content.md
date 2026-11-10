# Website Content — usesynapse.dev

> Edit this file, then I'll apply changes back to index.html.
> Lines starting with `>` are notes — they won't appear on the site.

---

## NAV

- Brand: `SYNAPSE`
- Links: Features | How It Works | Screenshots | Mobile | GitHub
- CTA button: `npm install`

---

## HERO

> Badge (green pill at top)
v0.1.0 · Works with Claude Code · MIT licensed

> Headline
See what your **AI agents** are actually doing

> Subheading
Claude Code does a lot of things behind a blinking cursor. Synapse renders all of it as a live, interactive node graph. Because understanding is its own reward.

> Install command
`npm install -g @synapse-ai/cli`

> Install hint
Then: `synapse start` · Requires Node.js 20+

> Hero image: `desktop_nodegraph_lens.png`

---

## FEATURES

> Section label
What You Get

> Section heading
Not another dashboard. A living graph of Claude's activities.

> Section description
Agents spawning subagents calling tools spawning more agents — all rendered in real-time so you can see what's actually happening instead of guessing.

### Live Node Graph
Sessions, agents, subagents, and tool calls as connected nodes with animated edges. Color-coded by status. Auto-expanding as agents spawn. Custom layout algorithm that handles arbitrarily deep trees without overlapping.

### Four Analysis Lenses
Same data, four perspectives. Tree view, treemap, sankey flow, and compaction timeline. Click a node in any lens — it highlights in the graph. Click a node in the graph — it highlights in every lens.

> Aside
The Sankey is all form, the Treemap is all function.

### Tool Call Grouping
47 tool calls don't produce 47 nodes. They're grouped into composites with three display modes: pill grid, timeline swimlanes, and density heatmap.

### Remote Approval
Start a job, walk away, approve permissions from your phone. Claude Code's HTTP hooks hold the request open until you tap Approve or Deny. Yes, others do this too. Now you have options.

> Aside
Requires --lan mode. Your home Wi-Fi, not the coffee shop.

### Keyboard Navigation
Arrow keys to walk the graph. Up/down the spine, left/right between siblings. Bracket keys for logical next/prev. Navigate a 200-node tree without touching the mouse.

### Node Inspector
Click any node to open a detail panel with full metadata — tool arguments, response payloads, token counts, timing, parent chain. Everything the graph summarizes, the inspector shows in full.

---

## HOW IT WORKS

> Section label
How It Works

> Section heading
One command. Zero configuration.

> Section description
You don't configure anything. You don't install plugins. You type one command and it just works.

### Step 1: Install
`npm i -g @synapse-ai/cli`

### Step 2: Start
`synapse start` in your project. Server starts, hooks configured, browser opens.

### Step 3: Use Claude
Run Claude Code like normal. Every agent spawn, tool call, and token streams to the graph in real-time.

### Step 4: Observe
Watch the machine think. Click nodes, drill into tool calls, switch lenses. Turns out, watching AI think is addictive.

### Security callout
**A note on security**

By default, Synapse binds to `localhost`. Nothing leaves your machine. Pass `--lan` to enable remote approval from your phone — this opens unauthenticated endpoints on your local network. Pass `--observe-only` for pure read-only monitoring with zero security surface. Full details in the Security Model.

---

## SCREENSHOTS

> Section label
See It

> Section heading
Screenshots

> Section description
Real screenshots from a live Claude Code session.

> Image captions (these appear below each screenshot on the page):
1. `desktop_nodegraph_lens_selected.png` — Agent tree with lens cross-highlighting
2. `desktop_nodeinspector.png` — Node inspector — full metadata at a click
3. `dektop__tools_pillgrid.png` — Tool grouping — pill grid
4. `desktop_tools_timeline.png` — Tool grouping — timeline
5. `desktop_tools_heatmap.png` — Tool grouping — frequency matrix
6. `desktop_remote-options.png` — Remote approval with deny + message

> Lightbox descriptions (shown when you click a screenshot):
1. The live agent graph with a node selected. Clicking any node cross-highlights it in the analysis lens below. Every session, agent, subagent, and tool call is a connected node — color-coded by status, auto-expanding as agents spawn.
2. The node inspector panel. Click any node to see its full metadata — tool arguments, response payloads, token counts, timing, and parent chain. Everything the graph summarizes at a glance, the inspector shows in full detail.
3. Tool grouping in pill grid mode. Instead of 47 tool calls producing 47 nodes, they're grouped into a single composite node. Each pill is color-coded by tool type — hover for details, click to expand.
4. Tool grouping in timeline mode. Tool calls are laid out chronologically as swimlanes, showing exactly when each tool fired and how long it took. Great for spotting sequential bottlenecks and parallel execution patterns.
5. Tool grouping in frequency matrix mode. A density visualization that shows which tools are called most frequently and where the hot spots are. The brighter the cell, the more activity — instantly reveals where the agent is spending its effort.
6. Remote approval with deny and message options. When Claude Code needs permission, the request appears as a card with countdown timer. You can approve, deny, or deny with a message explaining why — the agent receives your feedback and adjusts.

---

## MOBILE

> Section label
On the Go

> Section heading
Works on your phone.

> Section description
The full dashboard, responsive down to mobile. Approve permissions from the couch, check agent progress from the kitchen, watch the graph grow from anywhere on your network.

> Image captions:
1. `mobile_nodegraph.PNG` — Live graph
2. `mobile_approval.PNG` — Remote approval
3. `mobile_lens_sankey.PNG` — Sankey lens
4. `mobile_lens_treemap.PNG` — Treemap lens

> Lightbox descriptions:
1. The full agent graph on mobile. The same interactive node tree you see on desktop, responsive down to phone screens. Pinch to zoom, tap nodes to inspect — fully functional on the go.
2. Remote approval from your phone. Permission requests stack as cards with countdown timers. Tap to approve or deny from anywhere on your network — start a job at your desk, approve from the couch.
3. The sankey flow lens on mobile. Traces the flow of data and control between agents, tools, and sessions. The width of each band represents token volume — wider means more data flowing through that path.
4. The treemap lens on mobile. Each rectangle is sized proportionally to token usage. Instantly see which agents and tools are consuming the most context — the biggest boxes are where the money goes.

---

## ONE MORE THING

> Section label
One More Thing

> Section heading
Not every feature needs a business case.

> Section description
Tool call nodes aren't just data. They're canvases. Some of our visualization modes got a little... creative.

> Image captions:
1. `desktop_tools_gol.png` — Game of Life mode
2. `desktop_tools_snake.png` — Snake mode
3. `desktop_tools_breakout.png` — Breakout mode

> Lightbox descriptions:
1. Conway's Game of Life running inside a tool call node. Each cell represents a tool invocation — the simulation evolves as new calls come in. Completely pointless, absolutely delightful.
2. Each tool call extends the snake. The path it traces is the actual execution sequence — a self-playing visualization of work in progress.
3. Each brick is a tool call — the ball knocks them out as they complete. Fully automated, surprisingly satisfying to watch.

---

## VIDEO

> Section label
Watch

> Section heading
60-second demo

> Section description
From zero to full agent visibility in one minute. No narration needed — the graph speaks for itself.

> YouTube embed: https://www.youtube.com/embed/lovPSuhdHBM

---

## CTA (bottom call to action)

> Heading
You should probably see what your agents are doing.

> Subtext
One install. One command. All the visibility.

> Install command (same as hero)
`npm install -g @synapse-ai/cli`

> Tech stack pills
React 19 | React Flow v12 | TypeScript | Express 5 | sql.js | Zustand 5 | Tailwind 4 | Claude Code | MIT

---

## FOOTER

- Links: GitHub · npm · Security · Contact · MIT License
- Tagline: Built with curiosity, caffeine, and a mass amount of Claude.
- Note: Source code coming to GitHub soon — we didn't want to delay the release again.
- Version: v0.1.0
