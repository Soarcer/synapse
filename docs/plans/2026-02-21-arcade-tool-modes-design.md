# Arcade Tool Group Modes — Design Document

**Date:** 2026-02-21
**Status:** Approved
**Scope:** 3 new game-like tool group visualization modes + a separate arcade overlay

## Problem Statement

Tool calls arrive inside tool group nodes and stack up visually. The existing modes (Pill Grid, Timeline, Heatmap) are data-viz oriented and static. The user wants playful, game-like visualizations that still convey useful information, with an optional full arcade mode for retro effects.

## Design Goals

1. **Playful + informative baseline** — each game mode maps tool call properties (type, duration, status) to game mechanics
2. **Full arcade toggle** — CRT scanlines, pixel font, score counters, particles, optional 8-bit sounds
3. **Zero impact on existing code** — all new code is additive, behind feature flags, easily removable
4. **Performance** — no heavy game engines; CSS + SVG + lightweight canvas only

## Isolation & Killswitch

All new game mode code lives in a dedicated folder:

```
apps/dashboard/src/components/graph/nodes/
  game-modes/                # DELETE THIS FOLDER = fully removed
    BubblesMode.tsx          # gooey merge visualization
    TetrisMode.tsx           # stacking blocks
    PacManMode.tsx           # ghost-eating trail
    ArcadeOverlay.tsx        # CRT + pixel font + score + particles
    arcade-utils.ts          # shared: particle system, sound, score logic
    GooeyFilter.tsx          # SVG filter defs (reusable)
    index.ts                 # barrel export + GAME_MODES_ENABLED killswitch
```

**Killswitch constant:**

```typescript
// game-modes/index.ts
export const GAME_MODES_ENABLED = true; // flip to false = modes hidden from UI
```

**Existing files modified (minimal):**

- `ToolGroupNode.tsx` — 3 new case branches in mode switch + ArcadeOverlay wrapper
- `agentStore.ts` — `arcadeMode: boolean` + `setArcadeMode` action
- `ViewSettingsDropdown.tsx` — new "Game Modes" sub-section + arcade toggle
- `useAutoLayout.ts` — 3 new dimension entries in size switch
- Keyboard handler — `A` key for arcade mode toggle

No existing modes (pillGrid, timeline, heatmap) are modified.

## Type Changes

```typescript
// Extended tool group mode type
type ToolGroupMode =
  | 'pillGrid' // existing
  | 'timeline' // existing
  | 'heatmap' // existing
  | 'bubbles' // NEW — gooey merge
  | 'tetris' // NEW — stacking blocks
  | 'pacman'; // NEW — ghost eating trail

// New store state
arcadeMode: boolean; // separate toggle, applies to ALL modes
arcadeSoundEnabled: boolean; // sub-toggle for 8-bit sounds (off by default)
arcadeVolume: number; // 0-100, default 15
```

**Keyboard shortcut:** `A` key toggles arcade mode globally.

---

## Mode 1: Bubbles (Gooey Merge)

**Container:** 280×200px, dark bg, overflow hidden.

### SVG Gooey Filter

```xml
<filter id="goo-{parentId}">
  <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur"/>
  <feColorMatrix in="blur" mode="matrix"
    values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo"/>
  <feComposite in="SourceGraphic" in2="goo" operator="atop"/>
</filter>
```

### Data Mapping

| Game Element | Data Property                                        | Rationale              |
| ------------ | ---------------------------------------------------- | ---------------------- |
| Bubble       | One tool call                                        | Each tool = one circle |
| Bubble size  | Duration (`clamp(16, duration_ms/50, 48)` px radius) | Longer = bigger        |
| Bubble color | Tool type (TOOL_COLORS)                              | Visual grouping        |
| Merging      | Same-type tools overlap → goo filter merges them     | Shows tool clustering  |
| Floating     | Running tools bob `translateY(±4px)` over 2s         | Alive = in progress    |
| Pop          | Completion: scale 1→1.4, opacity 1→0 over 300ms      | Satisfying finish      |
| Sink         | Error: drift downward + desaturate                   | Visual error signal    |

### Layout

One wrapper `<div style="filter: url(#goo-{parentId}-{toolName})">` **per tool type** — same-color blobs merge, different colors don't. Blobs are absolutely positioned:

- X: distributed evenly by type cluster
- Y: container center with slight jitter
- New arrivals: scale from 0→1 with overshoot bounce

### Interaction

- **Hover on blob region:** reduce `stdDeviation` from 10→2 (un-goo) to reveal individuals
- **Click individual blob:** `selectNode('tool-' + toolUseId)`
- **Tooltip:** tool name + duration + status
- **Selected:** purple ring (consistent with other modes)

### Info Conveyed

- Color = tool type (**strong**)
- Blob size = duration (**strong**)
- Merged cluster size = count of that type (**moderate**)
- Animation state = running/complete/error (**strong**)

---

## Mode 2: Tetris (Stacking Blocks)

**Container:** 180×320px — 10 columns × 16 rows of 16×16px cells + 32px header.

### Data Mapping

| Game Element | Data Property                                         | Rationale             |
| ------------ | ----------------------------------------------------- | --------------------- |
| Block        | One tool call, 2 cells wide                           | Each tool = one brick |
| Block height | Duration: `clamp(1, ceil(duration_ms/1000), 4)` cells | Longer = taller       |
| Block color  | Tool type (TOOL_COLORS)                               | Visual grouping       |
| Drop-in      | New block: appears at top, animates to stack position | Tool starting         |
| Landed       | Block at rest at bottom of stack                      | Tool completed        |
| Ghost piece  | Low-opacity outline at predicted landing position     | Running tool hint     |
| Row clear    | Full row → flash white → slide out → above drops      | Batch completion      |
| Error stripe | Diagonal stripe overlay on error blocks               | Error indicator       |

### Grid State

A 2D array `boolean[16][10]` tracks occupied cells. Blocks placed using greedy column-fit (find first span with enough vertical space). Stacks bottom-up.

### Animations

- **Drop:** `transform: translateY()` with spring curve `cubic-bezier(0.34, 1.56, 0.64, 1)` — bounce on landing
- **Row clear:** flash white (200ms) → slide out left (200ms) → collapse gap (200ms)
- **Running:** block mid-fall, ghost piece visible below
- **Error:** diagonal stripe via `repeating-linear-gradient(45deg, ...)`

### Header

Dark bar: "TETRIS · 14 tools · Σ 2.3s" — pixel font in arcade mode, mono otherwise.

### Interaction

- **Click block:** `selectNode('tool-' + toolUseId)`
- **Hover:** brightness-125 + ring
- **Selected:** purple ring

### Info Conveyed

- Color = tool type (**strong**)
- Block height = duration (**strong**)
- Stack position = temporal order, bottom=oldest (**strong**)
- Row density = concurrency (**moderate**)
- Mid-fall = currently running (**strong**)

---

## Mode 3: Pac-Man (Ghost Eating Trail)

**Container:** 400×120px horizontal corridor.

### Data Mapping — Tools as Ghosts

| Game Element          | Data Property                                        | Rationale                                |
| --------------------- | ---------------------------------------------------- | ---------------------------------------- |
| Pac-Man               | The agent itself                                     | Moving left→right through its work       |
| Ghost                 | One tool call                                        | Classic ghost silhouette sprite          |
| Ghost color           | Tool type (TOOL_COLORS)                              | Each tool type = different colored ghost |
| Ghost size            | Duration: `clamp(12, duration_ms/100, 24)` px        | Longer tools = bigger ghosts             |
| Pac-Man eats ghost    | Tool completed                                       | Eyes floating back to start              |
| Ghost fleeing         | Running tool (ghost is blue/vulnerable)              | Pac-Man approaching                      |
| Ghost catches Pac-Man | Error state                                          | Pac-Man death spin animation             |
| Power pellet          | Successfully completed long tool (>2s)               | Triggers power mode                      |
| Score dots            | Small dots between ghosts for visual path continuity | Spacing filler                           |

### Ghost Sprites

16×16px pixel-art ghost silhouette rendered via CSS `box-shadow` technique (single div, multiple shadows = pixel grid). Each tool type gets its ghost colored from TOOL_COLORS. The classic ghost shape (dome top, wavy bottom) is ~10 rows × 10 cols of shadows.

### Pac-Man Animation

```css
.pacman {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #ffdd00;
  clip-path: polygon(100% 50%, 50% 0%, 0% 0%, 0% 100%, 50% 100%);
  animation: chomp 0.3s infinite alternate;
}
@keyframes chomp {
  to {
    clip-path: polygon(100% 50%, 50% 10%, 0% 0%, 0% 100%, 50% 90%);
  }
}
```

### Layout

- Ghosts positioned left→right in chronological order along a horizontal path
- Pac-Man position = index of the last completed tool
- Path wraps to a second row if >10 ghosts (or container scrolls)
- Small dots between ghosts for the classic corridor look

### State Transitions

- **Running tool:** ghost ahead of Pac-Man turns blue (vulnerable), wobbles
- **Completed:** Pac-Man eats ghost → ghost becomes just floating eyes drifting back to the left
- **Error:** ghost stays solid, Pac-Man hits it → brief death spin (200ms), then continues

### Interaction

- **Click ghost:** `selectNode('tool-' + toolUseId)`
- **Hover ghost:** tooltip with tool name + duration
- **Selected:** purple ring around ghost

### Info Conveyed

- Ghost color = tool type (**strong**)
- Ghost size = duration (**moderate**)
- Eaten/uneaten = completion status (**strong**)
- Pac-Man position = progress through tool sequence (**strong**)
- Error ghosts = clearly visible failures in sequence (**strong**)

---

## Arcade Overlay

A **separate toggle** (`A` key) that wraps ANY ToolGroupNode mode with retro effects. This means even Pill Grid, Timeline, and Heatmap get the arcade treatment if enabled.

### Components

#### 1. CRT Scanlines (ArcadeOverlay.tsx)

A `pointer-events: none` overlay div on the node container:

```css
.crt-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 100;
  border-radius: 12px;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 1px,
    rgba(0, 0, 0, 0.15) 1px,
    rgba(0, 0, 0, 0.15) 2px
  );
  animation: crt-flicker 0.05s infinite alternate;
}
@keyframes crt-flicker {
  from {
    opacity: 0.97;
  }
  to {
    opacity: 1;
  }
}
```

Underlying content gets a subtle phosphor glow: `text-shadow: 0 0 4px currentColor`.

#### 2. Pixel Font

Google Font `Press Start 2P` applied to all text inside the node when arcade mode is on. Loaded on-demand (`<link>` injected when first activated, or bundled as a subset).

Font size reduced to 8px (it's large by nature).

#### 3. Score Counter

Positioned at top-right corner of node container:

- Formula: `tools_completed × (100 + combo × 50)`
- Combo increments on consecutive successes, resets on error
- Rolling digit animation: each digit slides up independently via `translateY`
- "COMBO ×3!" text with scale-bounce when combo > 1
- Seven-segment or pixel font styling

#### 4. Screen Shake

CSS keyframe on error events, applied to node container only:

```css
@keyframes screen-shake {
  0%,
  100% {
    transform: translate(0, 0);
  }
  10% {
    transform: translate(-2px, 1px);
  }
  20% {
    transform: translate(3px, -1px);
  }
  /* ... 8 more keyframes */
}
```

Duration: 400ms. Only the individual node shakes, not the React Flow canvas.

#### 5. Particle Bursts

Lightweight custom canvas overlay (position absolute, pointer-events none):

- **Tool completion:** 12 square pixel particles burst outward from tool position, colored by tool type
- **Error:** red pixel burst with downward gravity bias
- **Combo milestone:** confetti shower (30 particles, multi-color)
- Particles fade over 500ms, max ~50 active particles at any time

Implementation: ~50 lines of canvas 2D + requestAnimationFrame. Particle struct: `{ x, y, vx, vy, life, color, size }`.

#### 6. 8-Bit Sounds

**Off by default.** Separate sub-toggle + volume slider in settings.

Web Audio API oscillators (no audio files):

- Tool complete: rising square-wave chirp (880Hz, 100ms)
- Error: low sawtooth buzz (120Hz, 300ms)
- Row clear (Tetris): descending arpeggio (4 notes, 50ms each)
- Bubble pop: short sine burst (1200Hz, 50ms) with fast decay
- Ghost eaten (Pac-Man): classic ascending tone
- Combo milestone: triumphant chord (3 oscillators)

Master volume: 0-100%, default 15%. `AudioContext` created only on first interaction (Chrome autoplay policy).

### Performance

- CRT overlay: 1 div, negligible
- Particles: <50 active, canvas 2D, <0.5ms/frame
- Sound: Web Audio API, zero CPU when not playing
- Pixel font: loaded once, cached
- Total arcade overhead: <1ms per frame

---

## Layout Dimensions (useAutoLayout.ts)

New entries in the dimension computation switch:

| Mode    | Collapsed          | Expanded |
| ------- | ------------------ | -------- |
| bubbles | 180×36 (same chip) | 280×200  |
| tetris  | 180×36 (same chip) | 180×320  |
| pacman  | 180×36 (same chip) | 400×120  |

All modes share the same collapsed chip renderer (existing code).

---

## ViewSettingsDropdown Changes

New sections added:

```
Tool View
  ○ Pill Grid        (existing)
  ○ Timeline          (existing)
  ○ Heatmap           (existing)

Game Modes
  ○ Bubbles           (gooey merge)
  ○ Tetris            (stacking blocks)
  ○ Pac-Man           (ghost eating)

Arcade
  ⬜ Arcade Mode (A)   (CRT + pixel font + score + effects)
  ⬜ Sound Effects      (8-bit sounds, off by default)
  [Volume ████░░░░ 15%]
```

Game modes and data-viz modes are mutually exclusive (radio group across all 6).

---

## Implementation Notes

- No framer-motion dependency — all animations via CSS keyframes + transitions
- SVG gooey filter is inline (no external SVG files)
- Ghost pixel sprites via CSS box-shadow (no image assets)
- Pac-Man via CSS clip-path animation
- Press Start 2P font loaded from Google Fonts CDN on-demand
- Web Audio API for sounds (no audio file dependencies)
- All game state (grid, positions, score) is local component state — not in Zustand store
- Tool click/select/highlight behavior identical across all 6 modes
