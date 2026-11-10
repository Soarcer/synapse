# Screenshot Pipeline Design

## Problem

Synapse needs a comprehensive, repeatable screenshot set for both the GitHub README/project page and a dedicated landing site. Screenshots must be pixel-perfect, retina-quality, and captured at consistent viewport sizes every time. Manual capture is error-prone and not repeatable.

## Solution

A single Playwright script (`scripts/capture_screenshots.ts`) that:
1. Clears existing data via `DELETE /api/events` (verified: endpoint exists in `packages/server/src/routes/events.ts:89`) <!-- revised: verified P0 — DELETE endpoint exists -->
2. Seeds the dashboard with a visually optimized simulation via the API, with **500ms delays between events** for realistic timing <!-- revised: user requirement — realistic injection pacing -->
3. Navigates through every target view, interacting with the UI as needed
4. Captures each shot as both PNG and WebP at 2x retina resolution
5. Generates an `index.html` gallery page for visual QA <!-- revised: P1 PM — quality gate -->
6. Saves to `assets/screenshots/` organized by category

**Prerequisite**: The user starts the server and frontend manually (`start-server.ps1` + `start-client.ps1`). The script does NOT manage server lifecycle.

## Screenshot Inventory (19 shots)

### Hero Shots (4) — README banners, OG cards, landing page hero

| ID | Name | Viewport | Description |
|----|------|----------|-------------|
| H1 | `graph-overview` | 1280×800 @2x | TB layout, full graph: session → prompts → agents → tool groups. One agent node selected (highlight ring visible). |
| H2 | `graph-inspector` | 1440×800 @2x | Same graph state as H1, but with the Inspector panel open on the right showing agent detail (tokens, tools, status). Wider viewport prevents graph squeeze. <!-- revised: P1 UX — 1440 prevents cluttered graph when inspector is open --> |
| H3 | `sankey-flow` | 1280×800 @2x | Sankey lens active, showing Sessions → Prompts → Agents → Tools flow with realistic token data. Lens panel fills left side. |
| H4 | `social-preview` | 1280×640 @2x | Composed version of H1 at GitHub OG dimensions (2:1 aspect ratio). May need slight graph zoom adjustment to fit the shorter viewport. |

### Lens Shots (4) — feature showcase, one per active lens

| ID | Name | Description |
|----|------|-------------|
| L1 | `treemap` | Treemap lens with token metric selected. Nested rectangles showing cost distribution across agents/tools. |
| L2 | `compaction` | Compaction timeline with context growth sparkline and red compaction markers. |
| L3 | `sankey-detail` | Sankey lens zoomed in, with a node hovered to show tooltip. |
| L4 | `tree-view` | Tree lens with nodes expanded 2-3 levels deep, showing session → prompt → agent hierarchy. |

### Feature Shots (9) — secondary features

| ID | Name | Description |
|----|------|-------------|
| F1 | `toolgroup-pillgrid` | Expanded tool group node in Pill Grid mode. Colored pills with status dots, diverse tool types. Mode set via View Settings → Tool View section. <!-- revised: P1 Eng — specified exact interaction path --> |
| F2 | `toolgroup-timeline` | Expanded tool group in Timeline mode. Horizontal bars, color segments, time axis. Mode set via View Settings → Tool View section. |
| F3 | `toolgroup-heatmap` | Expanded tool group in Heatmap mode. Grid cells color-coded by duration/status. Mode set via View Settings → Tool View section. |
| F4 | `arcade-gameoflife` | Arcade mode: Game of Life. Wait **5 seconds** after activation for pattern evolution before capture. <!-- revised: P1 Eng — arcade games need time to produce visual state --> |
| F5 | `arcade-tetris` | Arcade mode: Tetris. Wait **8 seconds** for blocks to accumulate before capture. |
| F6 | `arcade-snake` | Arcade mode: Snake. Wait **6 seconds** for snake to grow and move before capture. |
| F7 | `arcade-breakout` | Arcade mode: Breakout. Wait **6 seconds** for ball to break some bricks before capture. |
| F8 | `view-settings` | View Settings dropdown open, showing all options (Lock Viewport, Tool View modes, Arcade modes, Export/Import/Clear). |
| F9 | `keyboard-shortcuts` | Keyboard shortcuts tooltip/overlay visible. |

### Mobile Shots (2) — responsive showcase

| ID | Name | Viewport | Description |
|----|------|----------|-------------|
| M1 | `mobile-graph` | 390×844 @2x | Mobile view with Graph tab active, showing the node graph scaled for phone. |
| M2 | `mobile-lens` | 390×844 @2x | Mobile view with Lens tab active, showing treemap or sankey on phone. |

## Capture Specifications

### Viewports & Resolution

| Use Case | CSS Viewport | Device Scale | Output Pixels | Display Width |
|----------|-------------|-------------|---------------|---------------|
| Desktop hero/lens/feature | 1280×800 | 2x | 2560×1600 | `<img width="894">` in README |
| Desktop with inspector | 1440×800 | 2x | 2880×1600 | `<img width="894">` in README <!-- revised: wider for H2 --> |
| Social preview (OG) | 1280×640 | 2x | 2560×1280 | Native OG card |
| Mobile | 390×844 | 2x | 780×1688 | Inside device frame mockup |

### File Formats
- **PNG**: Lossless, sharp text/edges. Primary for GitHub README (universal compatibility).
- **WebP**: ~26% smaller than PNG at same quality. Primary for dedicated landing site (faster load).
- Both formats captured for every shot.

### Output Structure

```
assets/screenshots/
├── hero/
│   ├── graph-overview.png / .webp
│   ├── graph-inspector.png / .webp
│   ├── sankey-flow.png / .webp
│   └── social-preview.png / .webp
├── lenses/
│   ├── treemap.png / .webp
│   ├── compaction.png / .webp
│   ├── sankey-detail.png / .webp
│   └── tree-view.png / .webp
├── features/
│   ├── toolgroup-pillgrid.png / .webp
│   ├── toolgroup-timeline.png / .webp
│   ├── toolgroup-heatmap.png / .webp
│   ├── arcade-gameoflife.png / .webp
│   ├── arcade-tetris.png / .webp
│   ├── arcade-snake.png / .webp
│   ├── arcade-breakout.png / .webp
│   ├── view-settings.png / .webp
│   └── keyboard-shortcuts.png / .webp
├── mobile/
│   ├── mobile-graph.png / .webp
│   └── mobile-lens.png / .webp
└── index.html              ← visual QA gallery page
```

## Custom Simulation Data

### Why Not `simulate_all_nodes.ts`

The existing simulation script creates 31 events designed for testing, not visual beauty. We need a screenshot-optimized simulation with:
- Enough nodes/edges for visual density without clutter
- Diverse tool types for rich color variety
- Realistic token counts so lenses look substantial
- Compaction events so the compaction lens has data
- Spread timing so timeline views have meaningful bars

### Simulation Scenario: "Multi-Agent Code Review"

**Session**: 1 session, model = "Opus 4.6", git branch = "feat/auth-refactor", status = active

**Prompts** (3, showing conversation progression):
- **P1**: "Analyze the auth module for security vulnerabilities" — completed, spawns 1 agent
- **P2**: "Refactor the database layer to use connection pooling" — completed, spawns 2 agents
- **P3**: "Add comprehensive test coverage for the refactored modules" — in progress, spawns 3 agents (1 still running)

**Agents** (6 total):
- A1 (under P1): Security audit — success, 4 tool calls (Read×2, Grep, Bash)
- A2 (under P2): DB schema refactor — success, 5 tool calls (Read, Edit×2, Bash, Write)
- A3 (under P2): Migration writer — success, 3 tool calls (Read, Write, Bash)
- A4 (under P3): Unit test writer — running, 4 tool calls so far (Read×2, Write, Glob)
- A5 (under P3): Integration test writer — success, 5 tool calls (Read, Write, Bash×2, WebSearch)
- A6 (under P3): Coverage reporter — error (intentional, for red state), 2 tool calls (Bash, Grep)

**Tool calls** (23 total): Read×6, Edit×2, Write×3, Bash×5, Grep×2, Glob×1, WebSearch×1, TodoWrite×1, Task×2
- Gives 9+ distinct tool types for pill grid color variety

**Token counts** (realistic):
- Input: 15k–50k per agent (150k total session)
- Output: 2k–8k per agent
- At least 2 agents with >30k input (makes treemap/sankey look substantial)

**Compaction events**: 2 compaction markers (after P1 and P2 completion)

**Timing**: Events spread across ~10 minutes of simulated wall time

### Event Injection Timing <!-- revised: user requirement + P1 Arch — realistic pacing -->

Events are injected with **500ms delays** between each POST to simulate realistic arrival:

```
Session start         → 500ms →
P1 (prompt)           → 500ms →
A1 (agent start)      → 500ms →
A1 tool 1 (Read)      → 500ms →
A1 tool 2 (Read)      → 500ms →
A1 tool 3 (Grep)      → 500ms →
A1 tool 4 (Bash)      → 500ms →
A1 (agent end)        → 500ms →
Compaction 1          → 500ms →
P2 (prompt)           → 500ms →
...etc
```

This produces ~17.5 seconds of injection time for ~35 events. The dashboard's WebSocket live-update will animate nodes appearing incrementally, and by the time seeding completes the graph is fully laid out.

**Event ordering** (must be respected):
1. Session start (always first)
2. Prompts in order (P1 → P2 → P3)
3. Each prompt's agents after their parent prompt
4. Each agent's tool calls after the agent start event
5. Agent end events after all their tool calls
6. Compaction events at their designated points

After all events are injected, wait for the graph to settle by polling for the expected number of `.react-flow__node` elements in the DOM, then wait an additional 1 second for layout animations to complete. <!-- revised: P1 Eng — DOM-based readiness check instead of fixed timeout -->

## Script Architecture

### `scripts/capture_screenshots.ts`

```
┌──────────────────────────────────────────────────────────────┐
│ capture_screenshots.ts                                       │
├──────────────────────────────────────────────────────────────┤
│ 1. DELETE /api/events (clear all, verify response ok)        │
│ 2. Seed simulation (POST /api/events × ~35, 500ms between)  │
│ 3. Wait for graph readiness (poll .react-flow__node count)   │
│ 4. For each shot in SHOT_LIST:                               │
│    a. Set viewport size                                      │
│    b. Navigate to target state (clicks, keys)                │
│    c. Wait for animations (per-shot timing, see below)       │
│    d. screenshot → PNG                                       │
│    e. screenshot → WebP                                      │
│ 5. Generate index.html gallery                               │
│ 6. Print summary (shot count, output dir, total time)        │
└──────────────────────────────────────────────────────────────┘
```

### Key Interactions

| Shot | Interaction Sequence | Wait |
|------|---------------------|------|
| H1 | Navigate to `localhost:5173`, wait for graph, click agent A2 node | 1s |
| H2 | Resize to 1440×800, click agent A2 to open inspector | 1s |
| H3 | Press `L` to show lens panel, press `4` for Sankey tab | 1s |
| H4 | Resize viewport to 1280×640, close lens, same graph state as H1 | 1s |
| L1 | Lens visible, press `1` for Treemap | 1s |
| L2 | Press `2` for Compaction | 1s |
| L3 | Press `4` for Sankey, hover a Sankey node for tooltip | 1s |
| L4 | Press `5` for Tree, click expand arrows on 2 levels | 1s |
| F1 | Click View Settings → Tool View → Pill Grid, click a tool group node | 1s |
| F2 | Click View Settings → Tool View → Timeline | 1s |
| F3 | Click View Settings → Tool View → Heatmap | 1s |
| F4 | Trigger IDDQD sequence, select Game of Life from arcade dropdown | **5s** |
| F5 | Switch to Tetris via dropdown | **8s** |
| F6 | Switch to Snake via dropdown | **6s** |
| F7 | Switch to Breakout via dropdown | **6s** |
| F8 | Deactivate arcade, click View Settings button in header | 500ms |
| F9 | Hover/click keyboard shortcuts help icon (?) | 500ms |
| M1 | Resize to 390×844, navigate to `?view=mobile` (Graph tab) | 1.5s |
| M2 | Tap Lens tab in bottom navigation | 1s |

**Tab key reference** (with heatmap/cost gated off): 1=treemap, 2=compaction, 3=cost(disabled), 4=sankey, 5=tree, 6=alerts

### Dependencies

- `playwright` — added as workspace root devDependency
- `@playwright/test` — NOT needed, using Playwright's library API directly

### Cross-Platform Notes <!-- revised: P2 Eng — Windows compatibility -->

- Use `path.join()` for all file paths (not hardcoded forward slashes)
- Use `fs.mkdirSync(dir, { recursive: true })` for output directories
- Tested on Windows 11 with bash shell

### Run Command

```bash
# Prerequisites: server + frontend already running
npx playwright install chromium  # one-time browser install
npx tsx scripts/capture_screenshots.ts
```

Optional flag: `--suffix=v2` appends to all filenames (e.g., `graph-overview-v2.png`) for A/B comparison across iterations. <!-- revised: P1 PM — versioning for iterations -->

## Quality Gate <!-- revised: P1 PM — success criteria -->

After capture, the script generates `assets/screenshots/index.html` — a simple gallery page that displays all 19 shots in a grid with labels. The user opens this in a browser to visually QA before committing:

- All nodes visible and readable at display size?
- Inspector data populated and not truncated?
- Lens visualizations have meaningful data?
- Arcade games show active gameplay state?
- Mobile views look reasonable (not empty/sparse)?
- No overlapping nodes or cut-off text?

## Display Guidelines

### GitHub README
```html
<img src="assets/screenshots/hero/graph-overview.png" width="894" alt="Synapse Dashboard — Node Graph">
```
- Always use `width="894"` (GitHub's max content width) for full-width hero images
- Use `width="700"` for detail/feature shots
- PNG format for universal compatibility

### Dedicated Landing Site
- Use WebP with PNG fallback via `<picture>` element
- Hero: serve at responsive sizes via CSS `max-width: 100%`
- Mobile mockups: place inside device frame SVG/CSS mockup

### Social Preview / OG
- Use `social-preview.png` (1280×640) as GitHub repository social image
- Same image works for OG meta tags on the landing site
- Also works for Twitter/Discord/Slack/LinkedIn link previews

## Dark Mode

All screenshots captured in dark mode only. Dark mode is:
- The default theme for the dashboard
- More visually striking for developer tools marketing
- Standard expectation for developer audience

## Open Questions / Deferred <!-- revised: P2 findings collected here -->

- **Empty state shot**: Consider adding an E1 shot showing the empty dashboard with "No events yet" message + green connection dot. Useful for onboarding docs. (P2 UX)
- **Mobile sparsity**: Mobile shots at 390×844 may look sparse with 6 agents. Test manually first; if sparse, consider a simpler simulation or tighter zoom for mobile-only shots. (P2 UX)
- **Idempotency**: If the DELETE /api/events call fails silently, re-running could create duplicate data. The script verifies the DELETE response and aborts on failure. (P2 Arch)
