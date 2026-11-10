# Session: Launch Day — 2026-03-28

## What We Accomplished
- Set up `bernhard@usesynapse.dev` email via Purelymail + Cloudflare DNS
- Created YouTube account (Synapse AI) and channel
- Built and deployed landing page to Cloudflare Pages at usesynapse.dev
- Replaced all placeholder content with real screenshots (13 images)
- Added hero video (WebM loop), YouTube embed, lightbox with descriptions
- Created GitHub repo (Soarcer/synapse) with README, LICENSE, screenshots — orphan branch, no code
- Enabled GitHub Discussions + posted welcome thread
- Published @synapse-ai/cli@0.1.3 to npm with updated README
- Created YouTube captions (.srt file)
- Drafted video voiceover script
- Posted to r/ClaudeAI (awaiting mod approval)
- Wrote sign-off: "Built with Claude. The ideas were mine. The 38,000 lines of code were not."

## Key Decisions & Reasoning
- **No source code on GitHub yet** — orphan branch with README + images only. Didn't want to delay release for code cleanup.
- **"I" not "we"** — one-person project, using "we" sounds like pretending to be a company.
- **No version numbers on website** — will need updating too often, removed to avoid staleness.
- **Removed cost tracking, compaction forensics from public features** — replaced with keyboard navigation. Simplified the story.
- **Four lenses not five/six** — tree view, treemap, sankey, compaction timeline. Matched actual shipped state.
- **No tech stack pills** — users don't pick tools based on what framework you used.
- **Purelymail over Google Workspace** — $10/year vs $84/year, already working, no need for Gmail suite.
- **bernhard@usesynapse.dev for YouTube** — real name on Google account for recovery credibility.

## What's Complete
- Website live at usesynapse.dev with all content finalized
- npm package @synapse-ai/cli@0.1.3 published with updated README
- GitHub repo live with correct README, screenshots, discussions
- YouTube channel + video with captions
- Reddit post submitted to r/ClaudeAI

## What Remains
- OG image (1200x630) for social link previews
- Animated hero GIF/WebM from video footage (hero.webm exists but may want a different clip)
- Video voiceover recording (script at docs/site/video-script.md)
- Code audit before open-sourcing
- npm publish with clean build (remove codex/gemini hooks from dist)
- Share on more platforms (Twitter, Hacker News, Claude Code Discord)

## Blockers & Open Questions
- Reddit post awaiting r/ClaudeAI mod approval — may need to repost if rejected
- DNS negative cache on PC's UniFi router was blocking usesynapse.dev — resolved by morning

## What We Tried That Didn't Work
- **git stash/checkout for orphan branch updates** — caused massive conflicts and reverted index.html and README.md to old versions. The orphan branch has completely different file trees. Lost all session edits to index.html.
- **Recovery**: Saved index.html from browser view-source, pushed README via GitHub API script. Worktree approach was cleaner but still had issues with stale content being copied.
- **Lesson**: Never use stash+checkout between branches with different file trees. Use worktrees or API for orphan branch updates. Also: commit important untracked files before doing any branch operations.
- **Chrome "Save As"** rewrites image paths and injects extra assets — view-source is the better recovery method.
- **`gh discussion create`** — command doesn't exist in gh CLI. Had to create manually.

## Files Changed This Session
- `README.md` — complete rewrite for public launch
- `docs/site/index.html` — restored from view-source after stash loss, all launch edits
- `docs/site/favicon.svg` — brain icon copied from VS Code extension
- `docs/site/images/` — 13 used images + hero.webm
- `docs/site/content.md` — editable text dump of all website copy
- `docs/site/video-script.md` — voiceover script draft
- `docs/site/synapse-captions.srt` — YouTube caption file
- `docs/github-welcome-discussion.md` — GitHub Discussions welcome post
- `packages/cli/package.json` — bumped to 0.1.3, updated description/keywords
- `packages/cli/README.md` — updated for launch
- `packages/cli/scripts/build.mjs` — removed codex/gemini hook copying
- `LICENSE` — MIT license file

## Trade-offs Made
- Shipped without OG image — link previews will be blank but didn't want to delay
- Analytics page still bundled in npm package (112KB) — not worth the risk of breaking dashboard build to remove
- Server bundle is 3.3MB (sql.js asm included) — accepted as cost of zero native deps
- Codex/gemini hooks still in 0.1.3 dist from cached build — will be clean in next publish
