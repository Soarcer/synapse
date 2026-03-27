# Research: Agent-Flow Competitive Analysis — 2026-03-26

## Goal

Understand how agent-flow positions itself vs Synapse, identify presentation/packaging gaps, and build a strategy to look more professional on GitHub, NPM, and VS Code Marketplace.

## Summary

- Agent-flow launched March 21, 2026 — 5 days ago — already has 422 stars and 419 marketplace installs
- It is a **much simpler tool** than Synapse (feature-wise Synapse is 5-10x deeper), but its packaging and presentation are polished
- Synapse's README is excellent in content but missing the single most important thing: **screenshots and GIFs**
- Synapse has no NPM package published yet, and the marketplace listing has 133 installs / 0 ratings
- The gap is not feature depth — it's **visual proof, distribution, and first-impression polish**

## Findings

### Agent-Flow Profile

| Metric               | Agent-Flow                   | Synapse                      |
| -------------------- | ---------------------------- | ---------------------------- |
| GitHub Stars         | 422                          | ~0 (not public?)             |
| Marketplace Installs | 419                          | 133                          |
| Marketplace Rating   | 5/5 (1 review)               | 0/5 (0 reviews)              |
| NPM Package          | Not published (VS Code only) | Not published (CLI planned)  |
| Last Updated         | March 26, 2026               | March 14, 2026               |
| Contributors         | 2                            | 1                            |
| Commits              | 26                           | 100+                         |
| License              | Apache 2.0                   | MIT                          |
| Test Count           | Unknown                      | 591                          |
| README Screenshots   | Yes (screenshot in README)   | 0 (all placeholder comments) |
| Demo Video           | YouTube link                 | None                         |
| CONTRIBUTING.md      | Yes                          | Yes                          |
| CODE_OF_CONDUCT.md   | Yes                          | Yes                          |
| TRADEMARK.md         | Yes                          | No                           |

**What agent-flow does well:**

- Clean, focused README — doesn't try to explain everything
- Screenshot right at the top — instant visual credibility
- YouTube demo video linked
- Published on VS Code Marketplace with proper metadata
- "Built for CraftMyGame" origin story (social proof)
- Apache 2.0 + trademark protection (looks serious/corporate)

**What agent-flow is missing (where Synapse is stronger):**

- No six lens views (tree, heatmap, treemap, sankey, compaction, cost)
- No mobile PWA / remote approval
- No prompt lab / coaching
- No tool grouping modes
- No cost tracking
- No compaction forensics
- No push notifications
- No CLI distribution
- No multi-vendor support
- No analytics
- No guided tour
- No API documentation
- No spawn/control agents from dashboard
- Much smaller test suite

### Synapse's Presentation Gaps — [verified]

1. **No screenshots anywhere** — README has 12 placeholder `<!-- 📸 -->` comments but zero actual images. This is the #1 gap. A README without visuals for a _visualization tool_ is like a restaurant menu with no photos and the word "food" in the description.

2. **No demo video** — Agent-flow has a YouTube walkthrough. Synapse has nothing.

3. **No hero image** — The first thing visitors see is a text-art `S Y N A P S E` header. Agent-flow shows an actual screenshot.

4. **NPM not published** — The CLI README says "Not yet published to npm — coming soon." The `npx @synapse-ai/cli` command in docs doesn't work for anyone yet.

5. **Marketplace listing thin** — 133 installs, 0 ratings, version 0.12.3 (high minor version can look unstable to some). No marketplace screenshots configured.

6. **GitHub repo may not be public** — `package.json` references `github.com/Soarcer/synapse` but no remote configured locally. If the repo isn't public, none of the README content matters.

7. **Stale badge data** — Test count badge is hardcoded `591_passing` as a static shield, not a live CI badge.

8. **No social proof signals** — No "built by" link, no blog post, no Hacker News thread, no Twitter/X announcement.

## Gaps & Unknowns

- Could not verify if github.com/Soarcer/synapse is public (no git remote configured)
- Agent-flow's exact install velocity unknown (could be launch spike)
- Don't know if agent-flow has CI/CD or test suite

## Recommendation

Synapse is the deeper, more mature product. The problem is purely presentation and distribution. Here's the priority-ordered action plan:

### TIER 1 — Do This Week (Biggest Impact)

**S1. Screenshots and GIFs** — This is the single highest-ROI action. Take 5-6 screenshots and 2-3 GIFs:

- Hero screenshot: full dashboard with a complex agent tree
- GIF: agent tree expanding in real-time
- GIF: clicking a node, inspector sliding open
- Screenshot grid: all six lens views (2x3)
- GIF: tool group mode switching
- Screenshot: mobile remote approval on phone
- Screenshot: VS Code split layout
- Store in `docs/assets/` and replace all `<!-- 📸 -->` placeholders

**S2. Demo Video** — Record a 2-3 minute screen recording:

- Start Claude Code, show hooks auto-connecting
- Show the graph building in real-time
- Click through lenses
- Show remote approval on phone
- Upload to YouTube, link in README

**S3. Publish the GitHub Repo** — If not already public, make it public. Without this, nothing else matters.

### TIER 2 — Do This Month (Distribution)

**S4. Publish @synapse-ai/cli to NPM** — Make `npx @synapse-ai/cli start` actually work. This is the lowest-friction entry point. Add:

- Proper `package.json` metadata (keywords, repository, homepage)
- NPM README (can be the CLI README you already have — it's good)
- `bin` entry configured
- NPM badges in root README

**S5. VS Code Marketplace Polish:**

- Add 3-5 marketplace screenshots (these show in the extension listing)
- Write a proper marketplace description (longer than the current one-liner)
- Bump to v1.0.0 — signals stability
- Ask a friend to leave a rating

**S6. Live CI Badge** — Replace the static test badge with a GitHub Actions badge that runs on push.

### TIER 3 — Do for Launch (Positioning)

**S7. Write a Launch Post** — Blog post or dev.to article: "I built a real-time dashboard for Claude Code and here's what I learned." Personal origin stories get shared.

**S8. Differentiation Table in README** — Add a "Why Synapse?" or comparison section:

```
| Feature | Synapse | Agent-Flow | Flowise |
|---------|---------|------------|---------|
| Live node graph | Yes | Yes | No |
| Six analysis lenses | Yes | No | No |
| Remote approval (mobile) | Yes | No | No |
| Cost tracking | Yes | No | No |
| Push notifications | Yes | No | No |
| CLI + Extension + PWA | Yes | Extension only | Web only |
```

**S9. Social Proof** — Post on X/Twitter, share in Claude Code Discord, submit to Hacker News. The README is written in a style that HN would love (honest, technical, opinionated).

**S10. Trademark/Branding** — Consider adding a proper logo SVG instead of the text-art header. Agent-flow has trademarked their name — whether or not you do the same, having a proper logo signals professionalism.

## Sources

- https://github.com/patoles/agent-flow
- https://marketplace.visualstudio.com/items?itemName=simon-p.agent-flow
- https://marketplace.visualstudio.com/items?itemName=Synapse.synapse-dev (different Synapse project)
- https://marketplace.visualstudio.com/items?itemName=Soarcer.synapse-vscode
