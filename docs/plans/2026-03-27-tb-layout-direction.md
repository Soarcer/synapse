# Top-to-Bottom Layout Direction — 2026-03-27

## Problem

Sessions and prompts flow left-to-right, which doesn't match the mental model of VS Code sessions (tabs across the top). Multiple sessions stack vertically, making it hard to compare them. Oldest-to-newest should read left-to-right across the top.

## Proposed Layout — Vertical Spine + Horizontal Shelves

<!-- revised: corrected from pure axis swap to hybrid model -->

```
SESSION₁              SESSION₂              SESSION₃
   │                     │                     │
PROMPT₁ ── RESP       PROMPT₁ ── RESP       PROMPT₁ ── RESP
   │        ── AGENT      │                     │        ── AGENT──tools
   │            ├─tools   │                     │
PROMPT₂ ── RESP       PROMPT₂ ── RESP       PROMPT₂ ── RESP
                          │        ── AGENT
                          │            ├─tools
                        PROMPT₃ ── RESP
```

- **Vertical spine:** session → prompt₁ → prompt₂ → ... (conversation depth)
- **Horizontal shelves:** at each prompt, response + agent + tools fan out to the right (turn breadth)
- Sessions in a horizontal row at the top, oldest left → newest right
- Thread edges hidden in TB mode (structural edges already show conversation flow)

## Files to Change

### Core Algorithm — `apps/dashboard/src/hooks/useAutoLayout.ts`

- Classify nodes as **spine** (session, userPrompt) vs **shelf** (response, agent, toolGroup, toolCall)
- Build spine-only children map; rank/BFS on spine tree only
- `rankMaxH` for vertical rank spacing (inflated for shelf node heights)
- `shelfWidth()` helper — total horizontal extent per prompt (prompt + response + agent + tools)
- `computeSubW()` for horizontal sibling spread
- `assignPos()`: Y from rank, X from horizontal band centering
- Shelf post-pass: position response/agent/tools to the right of parent prompt at same Y
- Tool stacking post-pass: mostly unchanged (tools right of agent)
- Root separation: horizontal (`globalOffsetX`) instead of vertical
- Spawn node: bottom-center

### Node Handles — all node components + `useHandlePositions.ts`

- Hook returns Bottom/Top (spine handles)
- Shelf nodes (AgentNode, AssistantResponseNode, ToolGroupNode, ToolCallNode) override to `target: Left`
- UserPromptNode: two source handles — Bottom (spine, id=`structural`) + Right (shelf, id=`shelf`)
- AgentNode: source handle Right (id=`tools`)
- Thread handles removed from UserPromptNode in TB mode

### Edge Builder — `AgentGraph.tsx`

- All edges specify explicit `sourceHandle`/`targetHandle`
- Thread edge creation disabled in TB mode

### Tests — `apps/dashboard/src/hooks/__tests__/useAutoLayout.test.ts`

- 11 tests all assert LR relationships → rewrite for TB
- 7 new tests: session row, shelf alignment, tool positioning, handle types, thread edges hidden

### Docs

- `docs/ARCHITECTURE.md` line 362: update LR reference
- `CLAUDE.md`: update layout constants reference

## Risks

- Shelf nodes taller than prompt → rank height must be inflated for shelf children
- Handle ID missing on any edge → wrong routing (systematic convention required)
- Wide tool fans may overlap sibling prompt shelves (shelfWidth accounts for this)
- Viewport aspect ratio changes (moderate width, tall graph)

## Approach

1. Create `experiment/tb-layout` branch
2. Scaffold: rename constants, add spine/shelf classification
3. Rewrite spine layout algorithm (rank, subtree width, position assignment)
4. Shelf post-pass (response/agent/tools right of prompt)
5. Handle & edge updates (IDs on all edges, shelf overrides)
6. Test rewrite + 7 new tests
7. Visual QA with real data
8. If it looks good, merge. If not, keep on experiment branch.

## Merge Criteria

Visual QA passes with 1-3 sessions of real data. With 3 sessions of varying depth, you can identify the deepest session within 2 seconds without scrolling.

## Estimate

~6 hours total. Isolated branch — no impact on other work.

## Priority

Post-launch (v0.2.0).

## Detailed Design

See `docs/plans/2026-03-27-tb-layout-direction-design.md` for the full algorithm pseudocode, handle conventions, edge ID scheme, and test plan.
