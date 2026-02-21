# Pixel Art HD Upgrade Design

**Date**: 2026-02-20
**Status**: Approved
**Branch**: TBD (will create from main)

## Problem Statement

The current pixel art office view (672x448 native, TILE=16) has two UX issues:

1. **Low resolution** — sprites and labels appear rough even with CSS scaling
2. **Ephemeral agents** — characters pop in/out with each event batch, making sessions feel frantic rather than like an observed office

## Approved Approach: Resolution Doubling + Behavioral Layer

Doubles native resolution (TILE 16→32) while adding persistent agent lifecycles with idle behaviors. No new files — all changes in existing modules.

---

## Section 1: Resolution Upgrade

### Constants
- `TILE`: 16 → 32
- Canvas: 672×448 → 1344×896 (same 42×28 grid)
- All coordinates remain in grid units — pixel math auto-scales via `TILE`

### Sprite Scaling (2× everywhere)
| Element | Current | HD |
|---------|---------|-----|
| Character body | 10×14 | 20×28 |
| Character head | 8×8 | 16×16 |
| Station icon | 16×16 | 32×32 |
| Station label font | 7px | 14px |
| Character label font | 7px | 14px |
| Particle size | 2-3px | 4-6px |
| Walk speed | ~2 tiles/s | ~2 tiles/s (but px/s doubles) |

### What Stays the Same
- Grid dimensions (42×28 tiles)
- All col/row coordinates in theme, pathfinding, stations
- CSS scaling logic (just scaling a bigger canvas)
- Post-effects (scanlines, vignette) — auto-scale with canvas size

---

## Section 2: Persistent Agent Lifecycle

### Core Change
Agents now live from `agent_start` to `agent_stop` instead of spawning/despawning per tool call.

### State Machine
```
spawn → idle → [walking → working → idle] → despawn
              ↑___________________________|
```

Tool commands (`dispatchToStation`) interrupt idle behavior and return to idle on completion.

### Idle Behaviors (weighted random)
| Behavior | Weight | Description |
|----------|--------|-------------|
| Sit at desk | 40% | Walk to assigned home desk, face desk, stay 8-15s |
| Wander | 20% | Pick random walkable tile, stroll there at 60% speed |
| Coffee/cooler | 25% | Walk to a point-of-interest, pause 4-8s with status icon |
| Socialize | 15% | Walk near another idle agent, both pause 3-6s |

### Home Desk Assignment
- New `homeDesks` array in theme config: `{ col, row }[]`
- On spawn, agent claims first unclaimed desk
- `Character.homeDesk` stores the assignment; released on despawn

### Implementation Details
- New `Character.idleTimer` and `Character.idleBehavior` fields
- `Character.pickIdleBehavior()` selects weighted random action
- Socialize checks: find nearest idle character within 5-tile radius
- Points of interest: coffee machine, water cooler (new `pointsOfInterest` in theme)

---

## Section 3: Cascading Changes

### Bridge Simplification
- Remove drip-feed queue from `usePixelBridge.ts` — no longer needed since agents persist
- `spawnAgent` / `despawnAgent` commands map 1:1 to `agent_start` / `agent_stop` events
- Tool events trigger `dispatchToStation` → character walks from current position (not spawned fresh)

### Demo Sequencer
- Stretch from ~25s to ~90s loop
- Show agents actually idling between tasks
- Include socialize and coffee interactions

### Theme Config Additions
```typescript
// Added to PixelTheme
homeDesks: { col: number; row: number }[];
pointsOfInterest: { col: number; row: number; name: string; icon: string }[];
```

### Test Updates
- All coordinate assertions multiply by 2 (TILE 16→32)
- New tests: idle behavior transitions, home desk assignment/release, socialize pairing
- Existing pathfinding tests: same grid, just bigger pixel values

---

## Files to Change (no new files)

| File | Changes |
|------|---------|
| `engine/types.ts` | TILE=32, add `homeDesks`/`pointsOfInterest` to PixelTheme, idle state types |
| `engine/Character.ts` | 2× sprite dims, idle behavior system, home desk, socialize |
| `engine/Station.ts` | 2× icon/label sizes |
| `engine/Decoration.ts` | 2× decoration rendering |
| `engine/SceneManager.ts` | Desk assignment, idle tick scheduling, handleCommand updates |
| `themes/retro-office.ts` | homeDesks array, pointsOfInterest, 2× any px constants |
| `modes/DemoSequencer.ts` | 90s loop, idle showcase |
| `bridge/usePixelBridge.ts` | Remove drip-feed, simplify to persistent lifecycle |
| `__tests__/Character.test.ts` | 2× coords, idle behavior tests |
| `__tests__/Station.test.ts` | 2× coords |
| `__tests__/TileMap.test.ts` | 2× coords |
| `__tests__/ParticleManager.test.ts` | 2× particle sizes |
| `__tests__/pathfinding.test.ts` | Same grid, pixel values ×2 |
| `__tests__/types.test.ts` | TILE=32 assertion |
| `__tests__/usePixelBridge.test.ts` | Remove drip-feed tests, add lifecycle tests |

## Success Criteria

1. Canvas renders at 1344×896 native, CSS-scaled to viewport
2. Sprites and labels are crisp at 2× size
3. Agents persist from session start to session stop
4. Idle agents exhibit visible behaviors (wandering, sitting, socializing)
5. Tool calls interrupt idle and return to idle on completion
6. All existing tests updated and passing
7. Demo mode runs a ~90s showcase loop
