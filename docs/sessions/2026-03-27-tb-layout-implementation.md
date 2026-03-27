# Session: TB Layout Implementation — 2026-03-27

## What We Accomplished

- Implemented TB (top-to-bottom) graph layout replacing the LR (left-to-right) layout
- Vertical spine: session → prompt chains stack downward with straight vertical connectors
- Horizontal shelves: shelf children (response, agent, toolgroup) stack vertically as rows, each chain extending rightward
- Spine chaining: multiple prompts under a session are automatically chained (session → p1 → p2 → p3) even though raw edges have all prompts as session children
- Always-visible response nodes (removed expandedTurns gate from Phase 1.5)
- Removed nested Claude response section from UserPromptNode (redundant with always-visible response nodes)
- Explicit handle IDs on all edges (structural/shelf/tools) via styledEdges memo
- Thread edges re-routed to structural handles (Bottom/Top) instead of filtered out
- Response node dimension feedback loop (same pattern as toolgroups — local state → useVisibleGraph → measured prop)
- Pixel-perfect handle alignment: even-height snapping, no-rounding center propagation, straight edges for single-child shelves
- 17 layout tests covering all TB-specific assertions
- TB test simulation script (`scripts/simulate_tb_test.ts`)

## Key Decisions & Reasoning

- **Shelf children stack vertically, not horizontally** — user's wireframe showed each direct child of a prompt getting its own row. The old single-row horizontal shelf didn't match the mental model.
- **Handle IDs in styledEdges (not store)** — keeps store schema unchanged, handle routing is a render concern. Easy to add LR/TB toggle later.
- **Thread edges kept in store, re-routed at render** — preserves future LR toggle path. Thread edges use structural handles (Bottom/Top) in TB mode.
- **Response nodes always visible** — with TB layout, response nodes are first-class shelf children. The expand/collapse toggle was removed.
- **Even-height snapping in nodeDims** — forces all measured heights to even values so h/2 is always whole, eliminating sub-pixel handle misalignment.
- **Straight edges for single-child shelf connections** — smoothstep introduces tiny kinks from borderRadius even at same Y. Straight edges eliminate this. Multi-child shelves keep smoothstep for vertical routing.
- **Center-aligned spine nodes** — spine parent centers horizontally over first child's center (not left-aligned) for straight vertical connectors.

## What's Complete

- TB layout algorithm (useAutoLayout.ts) — fully rewritten
- Handle positions (useHandlePositions.ts) — returns Bottom/Top for spine
- All node components updated with correct handle overrides
- Edge builder (AgentGraph.tsx styledEdges) — handle IDs, thread re-routing, straight/smoothstep selection
- Response dimension feedback loop
- 17 layout tests passing
- 1174 total tests passing
- Committed: `66d4634` on `experiment/prompt-threading`

## What Remains

- **Known visual bugs to fix** (user mentioned "bunch of bugs" — need to enumerate in next session)
- **LR/TB toggle** — architecture supports it but not implemented (deferred to v0.2.0)
- **Keyboard navigation remap** for TB layout (P2-5 from design doc)
- **fitView behavior** — may need tuning for tall TB graphs
- **Mobile portrait mode** — may benefit from TB layout (P2-3)
- 5 unstaged files from other sessions still need committing

## Blockers & Open Questions

- None blocking — layout is functional and committed

## What We Tried That Didn't Work

- **Single horizontal row for shelf children** — user wanted vertically stacked rows matching their wireframe
- **Centering spine nodes over child's shelfWidth** — caused misalignment when shelf was wider than node. Fixed by center-aligning over child's node width.
- **Left-aligning spine nodes with first child** — caused offset when session and prompt have different widths. Fixed by center-aligning.
- **Rounding positions to 2px grid** — didn't fix sub-pixel kinks because the issue was in React Flow's handle rendering, not our positions
- **Snapping heights to even in nodeDims only** — helped but wasn't sufficient. Had to also propagate exact parentHandleY through the chain without arithmetic drift.
- **Filtering thread edges entirely** — caused missing visible connections between chained prompts. Re-routing handles was the correct approach.
- **Default NODE_DEFAULTS height for response (80px → 140px)** — caused response to be too HIGH instead of too low. Root cause was that response nodes (synthetic) never got measured dimensions fed back. Fixed with responseDims state.

## Files Changed This Session

```
[committed] apps/dashboard/src/hooks/useAutoLayout.ts          — core TB layout algorithm
[committed] apps/dashboard/src/hooks/useHandlePositions.ts     — Bottom/Top spine handles
[committed] apps/dashboard/src/hooks/useVisibleGraph.ts        — always-visible responses + responseDims
[committed] apps/dashboard/src/hooks/__tests__/useAutoLayout.test.ts — 17 TB tests
[committed] apps/dashboard/src/components/graph/AgentGraph.tsx — edge handle routing
[committed] apps/dashboard/src/components/graph/CollapsibleSourceHandle.tsx — id prop
[committed] apps/dashboard/src/components/graph/nodes/UserPromptNode.tsx — shelf handle, removed response section
[committed] apps/dashboard/src/components/graph/nodes/AssistantResponseNode.tsx — Left target
[committed] apps/dashboard/src/components/graph/nodes/AgentNode.tsx — Left target, tools source
[committed] apps/dashboard/src/components/graph/nodes/ToolCallNode.tsx — Left target
[committed] apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx — Left target
[committed] apps/dashboard/src/components/graph/nodes/SessionNode.tsx — structural id
[committed] scripts/simulate_tb_test.ts — TB test simulation
[unstaged]  apps/dashboard/src/store/eventHandlers.ts — from other session
[unstaged]  apps/vscode/resources/synapse-server/* — from other session
[unstaged]  packages/core/src/* — from other session
```

## Trade-offs Made

- **Hardcoded TB (no toggle)** — ship and validate first, add LR toggle if users request it
- **Even-height snapping adds 1px to odd-height nodes** — imperceptible visually, eliminates sub-pixel alignment issues
- **Straight edges for single-child shelves** — loses the smoothstep aesthetic but eliminates kinks. Multi-child shelves still use smoothstep.
- **Response nodes always visible** — increases graph density but provides better information hierarchy
