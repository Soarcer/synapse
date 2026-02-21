# Pixel Art HD Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Double the pixel art resolution (TILE 16→32, canvas 672×448→1344×896) and replace ephemeral pop-in/pop-out agents with persistent characters that idle between tool calls.

**Architecture:** Same engine structure, same grid dimensions (42×28). TILE constant doubles; a scale factor `S = TILE / 16` propagates through all hardcoded pixel values. New idle behavior system in Character with weighted-random actions (wander, sit, coffee, socialize). SceneManager manages desk assignment. Bridge removes drip-feed queue since agents now persist.

**Tech Stack:** Canvas 2D, TypeScript, Vitest, React hooks

---

## Task 1: Types & Constants

**Files:**
- Modify: `apps/dashboard/src/components/pixel/engine/types.ts`
- Test: `apps/dashboard/src/__tests__/pixel/types.test.ts`

### Step 1: Write the failing test

Add to `types.test.ts` after the existing tests:

```typescript
it('TILE is 32 for HD resolution', () => {
  expect(TILE).toBe(32);
});

it('has homeDesks defined', () => {
  expect(RETRO_OFFICE.homeDesks).toBeDefined();
  expect(RETRO_OFFICE.homeDesks.length).toBeGreaterThanOrEqual(6);
});

it('has pointsOfInterest defined', () => {
  expect(RETRO_OFFICE.pointsOfInterest).toBeDefined();
  expect(RETRO_OFFICE.pointsOfInterest.length).toBeGreaterThanOrEqual(2);
});
```

Update the existing import line to also import `TILE`:
```typescript
import { TILE } from '../../components/pixel/engine/types';
```

### Step 2: Run test to verify it fails

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/types.test.ts`
Expected: FAIL — TILE is 16 (not 32), homeDesks/pointsOfInterest don't exist on PixelTheme

### Step 3: Implement types.ts changes

In `apps/dashboard/src/components/pixel/engine/types.ts`:

**Line 4** — change TILE:
```typescript
export const TILE = 32;
```

**After line 32** (after DecorationDef) — add new types:
```typescript
export interface DeskDef {
  col: number;
  row: number;
}

export interface PointOfInterestDef {
  col: number;
  row: number;
  name: string;
  icon: string;
}

export type IdleBehavior = 'sit' | 'wander' | 'coffee' | 'socialize';
```

**In PixelTheme interface** (after `outputStation` line) — add:
```typescript
  homeDesks: DeskDef[];
  pointsOfInterest: PointOfInterestDef[];
```

### Step 4: Run test to verify it passes

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/types.test.ts`
Expected: FAIL — theme doesn't have homeDesks/pointsOfInterest yet (that's Task 2). The TILE test should pass now.

Actually run just the TILE test:
Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/types.test.ts -t "TILE is 32"`
Expected: PASS

### Step 5: Commit

```bash
git add apps/dashboard/src/components/pixel/engine/types.ts apps/dashboard/src/__tests__/pixel/types.test.ts
git commit -m "feat(pixel): TILE 16→32 and add idle behavior types"
```

---

## Task 2: Theme Config

**Files:**
- Modify: `apps/dashboard/src/components/pixel/themes/retro-office.ts`
- Test: `apps/dashboard/src/__tests__/pixel/types.test.ts` (theme tests live here)

### Step 1: Implement theme changes

In `retro-office.ts`:

**Line 8** — update tileSize:
```typescript
  grid: { cols: 42, rows: 28, tileSize: 32 },
```

**Lines 36–39** — double model dimensions (keep speeds the same — px/s will auto-double since TILE doubled):
```typescript
    opus:    { width: 24, height: 32, speed: 90,  bodyColor: '#b82030', accentColor: '#ffd700', label: 'Opus' },
    sonnet:  { width: 20, height: 28, speed: 130, bodyColor: '#2855a0', accentColor: '#b0c0d0', label: 'Sonnet' },
    haiku:   { width: 16, height: 22, speed: 200, bodyColor: '#1e8c3a', accentColor: '#d0f0d0', label: 'Haiku' },
    manager: { width: 20, height: 28, speed: 100, bodyColor: '#2a2a2a', accentColor: '#cc2233', label: 'Manager' },
```

Note: speeds double because TILE doubled — a character at speed 90 now covers the same number of tiles/second as speed 45 did before, since tiles are now 32px instead of 16px.

**After outputStation (line 53)** — add homeDesks and pointsOfInterest:
```typescript
  homeDesks: [
    { col: 7, row: 10 },
    { col: 13, row: 10 },
    { col: 7, row: 17 },
    { col: 13, row: 17 },
    { col: 31, row: 10 },
    { col: 31, row: 17 },
    { col: 37, row: 10 },
    { col: 37, row: 17 },
  ],
  pointsOfInterest: [
    { col: 37, row: 5, name: 'coffee', icon: 'coffee' },
    { col: 37, row: 20, name: 'cooler', icon: 'cooler' },
  ],
```

Home desks are near stations (left bank: cols 7/13 near Read/Write/Glob/Grep; right bank: cols 31/37 near Edit/Bash/Web/Task). Points of interest reference existing decorations.

### Step 2: Run tests

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/types.test.ts`
Expected: All pass (including the new homeDesks/pointsOfInterest tests from Task 1)

### Step 3: Commit

```bash
git add apps/dashboard/src/components/pixel/themes/retro-office.ts
git commit -m "feat(pixel): 2× model dims, homeDesks, pointsOfInterest in theme"
```

---

## Task 3: Character — HD Sprites + Idle Behavior

This is the largest task. It has two parts: (A) scale all draw code by 2×, (B) add the idle behavior system.

**Files:**
- Modify: `apps/dashboard/src/components/pixel/engine/Character.ts`
- Test: `apps/dashboard/src/__tests__/pixel/Character.test.ts`

### Step 1: Write failing tests for idle behavior

Add to `Character.test.ts`:

```typescript
import { TILE } from '../../components/pixel/engine/types';

// ... existing tests ...

describe('idle behavior', () => {
  const opusCfg = RETRO_OFFICE.models.opus;
  const grid = Array.from({ length: 28 }, () => Array(42).fill(true));

  it('pickIdleBehavior returns a valid behavior', () => {
    const ch = new Character(20, 12, 'opus', opusCfg, 'test-idle');
    const behavior = ch.pickIdleBehavior();
    expect(['sit', 'wander', 'coffee', 'socialize']).toContain(behavior);
  });

  it('homeDesk can be assigned and released', () => {
    const ch = new Character(20, 12, 'opus', opusCfg, 'test-desk');
    expect(ch.homeDesk).toBeNull();
    ch.homeDesk = { col: 7, row: 10 };
    expect(ch.homeDesk).toEqual({ col: 7, row: 10 });
    ch.homeDesk = null;
    expect(ch.homeDesk).toBeNull();
  });

  it('idleTimer decrements during idle state', () => {
    const ch = new Character(20, 12, 'opus', opusCfg, 'test-timer');
    ch.state = 'idle';
    ch.idleTimer = 5.0;
    ch.update(1.0);
    expect(ch.idleTimer).toBeCloseTo(4.0);
  });

  it('idleTimer triggers onIdleExpired callback when it hits zero', () => {
    const ch = new Character(20, 12, 'opus', opusCfg, 'test-expired');
    ch.state = 'idle';
    ch.idleTimer = 0.5;
    let expired = false;
    ch.onIdleExpired = () => { expired = true; };
    ch.update(0.6);
    expect(expired).toBe(true);
  });
});
```

Also update the existing pixel position test:
```typescript
it('sets pixel position from tile coordinates', () => {
  const ch = new Character(10, 12, 'opus', opusCfg, 'a2');
  expect(ch.x).toBe(10 * TILE + TILE / 2);
  expect(ch.y).toBe(12 * TILE + TILE / 2);
});
```

And the arrival test — increase iteration count since tiles are now 32px:
```typescript
it('character arrives at destination and fires callback', () => {
  const haikuCfg = RETRO_OFFICE.models.haiku;
  const ch = new Character(5, 5, 'haiku', haikuCfg, 'a4');
  const grid = Array.from({ length: 28 }, () => Array(42).fill(true));
  let arrived = false;
  ch.moveTo(6, 5, grid, () => { arrived = true; });
  // haiku speed=200, 1 tile = 32px → needs ~0.16s
  for (let i = 0; i < 40; i++) ch.update(0.05);
  expect(arrived).toBe(true);
  expect(ch.state).toBe('idle');
});
```

### Step 2: Run tests to verify they fail

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/Character.test.ts`
Expected: FAIL — `pickIdleBehavior`, `homeDesk`, `idleTimer`, `onIdleExpired` don't exist on Character

### Step 3: Implement Character changes

#### 3a: Add new fields (after line 40 in Character.ts)

```typescript
  homeDesk: { col: number; row: number } | null = null;
  idleBehavior: IdleBehavior | null = null;
  idleTimer = 0;
  wanderSpeed = 0.6; // fraction of normal speed for idle wandering
  onIdleExpired: (() => void) | null = null;
```

Add import at top:
```typescript
import type { ModelConfig, CharacterState, Direction, IdleBehavior } from './types';
```

#### 3b: Add pickIdleBehavior method (after moveTo)

```typescript
  pickIdleBehavior(): IdleBehavior {
    const r = Math.random();
    if (r < 0.40) return 'sit';
    if (r < 0.60) return 'wander';
    if (r < 0.85) return 'coffee';
    return 'socialize';
  }
```

#### 3c: Update update() — add idle timer decrement

In the `update(dt)` method, add a case at the end of the switch (before the closing brace), or in the existing idle handling area. Since `idle` currently has no case in the switch, add one:

```typescript
      case 'idle':
        if (this.idleTimer > 0) {
          this.idleTimer -= dt;
          if (this.idleTimer <= 0) {
            this.idleTimer = 0;
            if (this.onIdleExpired) this.onIdleExpired();
          }
        }
        break;
```

#### 3d: Scale all draw code

The draw method uses many hardcoded pixel values. Introduce a scale factor at the top of draw():

```typescript
  draw(ctx: CanvasRenderingContext2D): void {
    if (this.alpha <= 0) return;
    ctx.globalAlpha = this.alpha;
    const S = TILE / 16; // scale factor (1 at TILE=16, 2 at TILE=32)
    const x = Math.floor(this.x), y = Math.floor(this.y);
    const hw = this.w / 2, hh = this.h / 2;
```

Then multiply all hardcoded pixel constants by `S`. Key changes:

**Bob amplitude:**
```typescript
    const bob = this.state === 'walking'
      ? Math.sin(this.walkDist * 0.5) * S
      : Math.sin((this.stateTime + this.bobOffset) * 1.5) * 0.5 * S;
```

**Shadow:**
```typescript
    ctx.ellipse(x, y + hh + S, hw * 0.8, 2 * S, 0, 0, Math.PI * 2);
```

**Spawn sparkles:**
```typescript
      const r = (1 - this.spawnTimer / 0.5) * 16 * S;
      ctx.fillRect(x + Math.cos(a) * r - S, y + Math.sin(a) * r - S, 2 * S, 2 * S);
```

**Feet:**
```typescript
    const legSpread = this.state === 'walking' ? Math.sin(this.walkFrame * Math.PI / 2) * 2 * S : 0;
    ctx.fillRect(x - hw / 2 - S, y + hh - 3 * S + bob, 2 * S, 3 * S);
    ctx.fillRect(x + hw / 2 - S + legSpread, y + hh - 3 * S + bob, 2 * S, 3 * S);
```

**Body:**
```typescript
    ctx.fillRect(x - hw / 2, y + hh - bodyH - 2 * S + bob, hw, bodyH);
```

**Opus accent:**
```typescript
      ctx.fillRect(x - hw / 2, y + hh - 5 * S + bob, hw, 2 * S);
      ctx.fillRect(x - hw / 2 - S, y + hh - 7 * S + bob, hw + 2 * S, 3 * S);
```

**Manager tie:**
```typescript
      ctx.fillRect(x - S, y + hh - bodyH + 2 * S + bob, 2 * S, bodyH - 4 * S);
```

**Eyes:**
```typescript
    const eyeY = headY - S;
    if (this.dir === 'left') {
      ctx.fillRect(x - headR + S, eyeY, S, S);
      ctx.fillRect(x - S, eyeY, S, S);
    } else if (this.dir === 'right') {
      ctx.fillRect(x + headR - 2 * S, eyeY, S, S);
      ctx.fillRect(x, eyeY, S, S);
    } else {
      ctx.fillRect(x - 2 * S, eyeY, S, S);
      ctx.fillRect(x + S, eyeY, S, S);
    }
```

**Crown (opus):**
```typescript
      ctx.fillRect(x - headR - S, headY - headR - 2 * S, headR * 2 + 2 * S, 3 * S);
      ctx.fillRect(x - headR, headY - headR - 4 * S, 2 * S, 3 * S);
      ctx.fillRect(x - S, headY - headR - 5 * S, 2 * S, 4 * S);
      ctx.fillRect(x + headR - 2 * S, headY - headR - 4 * S, 2 * S, 3 * S);
```

**Headband (haiku):**
```typescript
      ctx.fillRect(x - headR, headY - S, headR * 2, S);
```

**Paper:**
```typescript
      ctx.fillRect(paperX, y + bob, 5 * S, 6 * S);
      ctx.fillRect(paperX + S, y + S + bob, 3 * S, S);
      ctx.fillRect(paperX + S, y + 3 * S + bob, 2 * S, S);
```

**Working dots:**
```typescript
          ctx.fillRect(x - 3 * S + d * 3 * S, headY - headR - 8 * S, 2 * S, 2 * S);
```

**Status icons:**
```typescript
      ctx.fillRect(x - S, headY - headR - 10 * S, 3 * S, 6 * S);
      ctx.fillRect(x - S, headY - headR - 3 * S, 3 * S, 2 * S);
    // Checkmark:
      ctx.font = `${8 * S}px monospace`;
      ctx.fillText('✓', x, headY - headR - 4 * S);
```

**Name label:**
```typescript
    ctx.font = `${5 * S}px monospace`;
    ctx.fillText(this.label, x, y - hh - 3 * S + bob);
```

Also scale the `walkDist` divisor for walk frame (currently `6`):
```typescript
    this.walkFrame = Math.floor(this.walkDist / (6 * (TILE / 16))) % 4;
```

Wait — actually `walkDist` accumulates `speed * dt` which is now in bigger pixels. The step distance per tile is now 32px instead of 16px. The frame divisor `6` means "change frame every 6 pixels of travel". At 2× resolution we want to change every 12px. So:
```typescript
    this.walkFrame = Math.floor(this.walkDist / 12) % 4;
```

Or more generically, keep using the scale factor pattern:
```typescript
    this.walkFrame = Math.floor(this.walkDist / (6 * TILE / 16)) % 4;
```

### Step 4: Run tests

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/Character.test.ts`
Expected: All pass

### Step 5: Commit

```bash
git add apps/dashboard/src/components/pixel/engine/Character.ts apps/dashboard/src/__tests__/pixel/Character.test.ts
git commit -m "feat(pixel): 2× character sprites + idle behavior system"
```

---

## Task 4: Station — HD Rendering

**Files:**
- Modify: `apps/dashboard/src/components/pixel/engine/Station.ts`
- Test: `apps/dashboard/src/__tests__/pixel/Station.test.ts`

### Step 1: Update test

In `Station.test.ts`, update the pixel coordinate test:

```typescript
import { TILE } from '../../components/pixel/engine/types';

it('returns correct pixel coordinates', () => {
  // col=5, row=8 → px = 5 * TILE, py = 8 * TILE
  expect(s.px).toBe(5 * TILE);
  expect(s.py).toBe(8 * TILE);
});
```

### Step 2: Run test

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/Station.test.ts`
Expected: PASS (px/py derive from TILE at runtime, so they auto-scale). All 6 tests should pass without Station.ts code changes — the computed properties `get px()` and `get py()` already use `TILE`.

### Step 3: Scale Station draw code

Introduce scale factor at top of `draw()` and `drawIcon()`:

```typescript
  draw(ctx: CanvasRenderingContext2D): void {
    const x = this.px, y = this.py;
    const p = this.palette;
    const T = TILE;
    const S = T / 16;
```

Then multiply all hardcoded pixel constants by `S`. The pattern is the same as Character — every literal number that represents pixels gets `* S`.

**Glow:**
```typescript
      ctx.fillRect(x - 3 * S, y - 3 * S, T * 2 + 6 * S, T * 2 + 6 * S);
```

**Desk base:**
```typescript
    ctx.fillRect(x - S, y + T * 2 - 4 * S, T * 2 + 2 * S, 5 * S);
    ctx.fillRect(x, y + T * 2 - 5 * S, T * 2, 5 * S);
```

**Label:**
```typescript
    ctx.font = `${6 * S}px monospace`;
    ctx.fillText(this.name, x + T, y + T * 2 + 6 * S);
```

**drawIcon** — pass `S` alongside `T`:

```typescript
  private drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, T: number): void {
    const t = this.activeTime;
    const p = this.palette;
    const S = T / 16;
```

Then scale every pixel literal in every icon case. This is mechanical — every number like `2`, `4`, `6`, `8`, `12`, `14` etc. that represents a pixel offset or dimension gets `* S`.

Examples for terminal icon:
```typescript
      case 'terminal': {
        ctx.fillStyle = '#444';
        ctx.fillRect(x + 2 * S, y, T * 2 - 4 * S, T + 8 * S);
        ctx.fillStyle = '#0c0c1c';
        ctx.fillRect(x + 4 * S, y + 2 * S, T * 2 - 8 * S, T + 4 * S);
        // ... same pattern for all lines
```

Apply the same `* S` pattern to every icon: `cabinet`, `typewriter`, `drafting`, `magnifier`, `bookshelf`, `globe`, `dispatch`.

### Step 4: Run tests

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/Station.test.ts`
Expected: All 6 pass

### Step 5: Commit

```bash
git add apps/dashboard/src/components/pixel/engine/Station.ts apps/dashboard/src/__tests__/pixel/Station.test.ts
git commit -m "feat(pixel): 2× station icons and labels"
```

---

## Task 5: Decoration — HD Rendering

**Files:**
- Modify: `apps/dashboard/src/components/pixel/engine/Decoration.ts`

No dedicated tests for Decoration (tested visually). Apply the same `S = T / 16` pattern.

### Step 1: Scale decoration rendering

At top of `drawDecoration`:
```typescript
  const x = d.col * TILE, y = d.row * TILE;
  const T = TILE;
  const S = T / 16;
```

Then multiply all pixel literals by `S` in every case: `plant`, `coffee`, `clock`, `board`, `cooler`, `output`, `costmeter`.

Examples for plant:
```typescript
    case 'plant': {
      ctx.fillStyle = '#8b5e2a';
      ctx.fillRect(x + 4 * S, y + 10 * S, 8 * S, 6 * S);
      ctx.fillStyle = '#2d8b37';
      const sway = Math.sin(time * 1.5 + d.col) * S;
      ctx.fillRect(x + 3 * S + sway, y + 2 * S, 4 * S, 9 * S);
      // ... etc
```

Font sizes:
```typescript
      ctx.font = `${5 * S}px monospace`;  // was '5px monospace'
      ctx.font = `${6 * S}px monospace`;  // was '6px monospace'
```

Clock hand lengths:
```typescript
      ctx.arc(cx, cy, 6 * S, 0, Math.PI * 2);  // clock face
      // minute hand length:
      ctx.lineTo(cx + Math.sin(...) * 4 * S, cy - Math.cos(...) * 4 * S);
      // second hand length:
      ctx.lineTo(cx + Math.sin(...) * 5 * S, cy - Math.cos(...) * 5 * S);
```

### Step 2: Run all pixel tests

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/`
Expected: Pass (Decoration has no unit tests; existing tests should still pass)

### Step 3: Commit

```bash
git add apps/dashboard/src/components/pixel/engine/Decoration.ts
git commit -m "feat(pixel): 2× decoration rendering"
```

---

## Task 6: ParticleManager — HD Particles

**Files:**
- Modify: `apps/dashboard/src/components/pixel/engine/ParticleManager.ts`
- Test: `apps/dashboard/src/__tests__/pixel/ParticleManager.test.ts`

### Step 1: Scale particle sizes and velocities

Import TILE at top:
```typescript
import { TILE } from './types';
```

In `createParticle()`, define scale factor:
```typescript
function createParticle(type: ParticleType, x: number, y: number): Particle {
  const S = TILE / 16;
  const p: Particle = { x, y, vx: 0, vy: 0, life: 1, maxLife: 1, size: S, color: '#fff', type };
```

Then scale sizes and velocities:

| Property | Old | New |
|----------|-----|-----|
| dust.size | 1 | `S` |
| dust.vx | ±10 | `±10 * S` |
| dust.vy | -8 to -2 | `(-8 to -2) * S` |
| token.size | 2 | `2 * S` |
| token.vx | ±20 | `±20 * S` |
| token.vy | -30 to -15 | `(-30 to -15) * S` |
| sparkle.size | 1-2 | `S + floor(random() * S)` |
| sparkle.vx/vy | ±30 | `±30 * S` |
| error.size | 2 | `2 * S` |
| error.vx | ±15 | `±15 * S` |
| error.vy | -20 to -10 | `(-20 to -10) * S` |
| steam.size | 2-3 | `2*S + floor(random() * S)` |
| steam.vx | ±3 | `±3 * S` |
| steam.vy | -8 to -4 | `(-8 to -4) * S` |
| cache.size | 1 | `S` |
| cache.vx | ±8 | `±8 * S` |
| cache.vy | -12 to -5 | `(-12 to -5) * S` |

Also scale gravity in update():
```typescript
      if (p.type === 'token' || p.type === 'error') p.vy += 20 * (TILE / 16) * dt;
      if (p.type === 'steam') p.vx += (Math.random() - 0.5) * 2 * (TILE / 16);
```

### Step 2: Run particle tests

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/ParticleManager.test.ts`
Expected: All 7 pass. Tests check count, lifecycle, type membership, and gravity direction — none assert exact pixel sizes.

### Step 3: Commit

```bash
git add apps/dashboard/src/components/pixel/engine/ParticleManager.ts
git commit -m "feat(pixel): 2× particle sizes and velocities"
```

---

## Task 7: SceneManager — Desk Assignment + Idle Scheduling

**Files:**
- Modify: `apps/dashboard/src/components/pixel/engine/SceneManager.ts`

### Step 1: Add desk management fields

After `currentCost = 0` (line 39), add:

```typescript
  private deskAssignments: Map<string, { col: number; row: number }> = new Map();
  private availableDesks: { col: number; row: number }[] = [];
```

In constructor, after building stations (line 65):
```typescript
    this.availableDesks = [...theme.homeDesks];
```

### Step 2: Add desk claim/release methods

```typescript
  private claimDesk(agentId: string): { col: number; row: number } | null {
    if (this.availableDesks.length === 0) return null;
    const desk = this.availableDesks.shift()!;
    this.deskAssignments.set(agentId, desk);
    return desk;
  }

  private releaseDesk(agentId: string): void {
    const desk = this.deskAssignments.get(agentId);
    if (desk) {
      this.deskAssignments.delete(agentId);
      this.availableDesks.push(desk);
    }
  }
```

### Step 3: Add idle behavior scheduling

```typescript
  private scheduleIdle(ch: Character): void {
    const behavior = ch.pickIdleBehavior();
    ch.idleBehavior = behavior;
    const grid = this.tileMap.getWalkabilityGrid();

    switch (behavior) {
      case 'sit': {
        const desk = ch.homeDesk;
        if (desk) {
          ch.moveTo(desk.col, desk.row + 2, grid, () => {
            ch.state = 'idle';
            ch.dir = 'up';
            ch.idleTimer = 8 + Math.random() * 7; // 8-15s
            ch.onIdleExpired = () => this.scheduleIdle(ch);
          });
        } else {
          // No desk — fall through to wander
          this.scheduleWander(ch, grid);
        }
        break;
      }
      case 'wander':
        this.scheduleWander(ch, grid);
        break;
      case 'coffee': {
        const poi = this.theme.pointsOfInterest[
          Math.floor(Math.random() * this.theme.pointsOfInterest.length)
        ];
        if (poi) {
          ch.moveTo(poi.col, poi.row + 2, grid, () => {
            ch.state = 'idle';
            ch.dir = 'up';
            ch.idleTimer = 4 + Math.random() * 4; // 4-8s
            ch.onIdleExpired = () => this.scheduleIdle(ch);
          });
        } else {
          this.scheduleWander(ch, grid);
        }
        break;
      }
      case 'socialize': {
        // Find nearest idle character
        let nearest: Character | null = null;
        let nearestDist = Infinity;
        for (const other of this.characters.values()) {
          if (other.agentId === ch.agentId) continue;
          if (other.state !== 'idle') continue;
          const d = Math.abs(other.col - ch.col) + Math.abs(other.row - ch.row);
          if (d < nearestDist && d <= 10) {
            nearest = other;
            nearestDist = d;
          }
        }
        if (nearest) {
          ch.moveTo(nearest.col + 1, nearest.row, grid, () => {
            ch.state = 'idle';
            ch.dir = 'left';
            ch.idleTimer = 3 + Math.random() * 3; // 3-6s
            ch.onIdleExpired = () => this.scheduleIdle(ch);
          });
        } else {
          this.scheduleWander(ch, grid);
        }
        break;
      }
    }
  }

  private scheduleWander(ch: Character, grid: boolean[][]): void {
    const cols = this.theme.grid.cols;
    const rows = this.theme.grid.rows;
    let tc: number, tr: number;
    let attempts = 0;
    do {
      tc = 3 + Math.floor(Math.random() * (cols - 6));
      tr = 3 + Math.floor(Math.random() * (rows - 6));
      attempts++;
    } while (!grid[tr]?.[tc] && attempts < 20);

    ch.moveTo(tc, tr, grid, () => {
      ch.state = 'idle';
      ch.idleTimer = 2 + Math.random() * 3; // 2-5s pause
      ch.onIdleExpired = () => this.scheduleIdle(ch);
    });
  }
```

### Step 4: Update handleCommand

**spawnAgent:** After creating the character, claim a desk and schedule idle:

```typescript
      case 'spawnAgent': {
        const modelKey = this.resolveModel(cmd.model);
        const config = this.theme.models[modelKey] ?? this.theme.models.sonnet;
        const { col, row } = this.theme.spawnArea;
        const ch = new Character(col, row, modelKey, config, cmd.agentId);
        ch.agentType = cmd.agentType;
        ch.state = 'spawning';
        ch.alpha = 0;
        ch.onDust = (dx, dy) => this.particles.emit('dust', dx, dy, 1);
        // Assign home desk
        const desk = this.claimDesk(cmd.agentId);
        if (desk) ch.homeDesk = desk;
        this.characters.set(cmd.agentId, ch);
        this.particles.emit('sparkle', ch.x, ch.y, 12);
        // After spawn animation completes, start idle behavior
        const origState = ch.state;
        const checkIdle = () => {
          if (ch.state === 'idle' && !ch.idleBehavior) {
            this.scheduleIdle(ch);
          }
        };
        // Schedule check after spawn timer (0.5s)
        setTimeout(checkIdle, 600);
        break;
      }
```

**despawnAgent:** Release desk, remove idle callbacks:

```typescript
      case 'despawnAgent': {
        const ch = this.characters.get(cmd.agentId);
        if (!ch) break;
        ch.state = 'despawning';
        ch.statusIcon = cmd.success ? '✓' : '!';
        ch.statusTimer = 1.5;
        ch.onIdleExpired = null; // stop idle loop
        ch.idleBehavior = null;
        this.releaseDesk(cmd.agentId);
        this.particles.emit(cmd.success ? 'sparkle' : 'error', ch.x, ch.y, 8);
        setTimeout(() => this.characters.delete(cmd.agentId), 3000);
        break;
      }
```

**dispatchToStation:** Interrupt idle behavior:

```typescript
      case 'dispatchToStation': {
        const ch = this.characters.get(cmd.agentId);
        const station = this.stationByName.get(cmd.stationName);
        if (!ch || !station) break;
        // Interrupt any idle behavior
        ch.onIdleExpired = null;
        ch.idleBehavior = null;
        ch.idleTimer = 0;
        const approach = this.tileMap.getApproachTile(station);
        ch.moveTo(approach.c, approach.r, this.tileMap.getWalkabilityGrid(), () => {
          ch.state = 'working';
          ch.dir = 'up';
          station.activate();
        });
        break;
      }
```

**stationComplete:** Resume idle behavior:

```typescript
      case 'stationComplete': {
        const ch = this.characters.get(cmd.agentId);
        const station = this.stationByName.get(cmd.stationName);
        if (station) station.deactivate();
        if (ch) {
          ch.state = 'idle';
          // Resume idle behaviors after a short pause
          ch.idleTimer = 1 + Math.random() * 2;
          ch.onIdleExpired = () => this.scheduleIdle(ch);
        }
        break;
      }
```

### Step 5: Scale remaining pixel constants in SceneManager

In `managerDeliver`, `drawPostEffects`, and constructor, apply `S = TILE / 16`:

**Constructor canvas styles** — no changes needed (border/shadow are CSS, not canvas).

**managerDeliver:**
```typescript
  private managerDeliver(promptText: string, targetAgentId: string): void {
    const grid = this.tileMap.getWalkabilityGrid();
    this.manager.alpha = 1;
    this.manager.col = this.theme.door.col;
    this.manager.row = 2;
    this.manager.x = this.manager.col * TILE + TILE / 2;
    this.manager.y = 2 * TILE + TILE / 2;
    // ... rest stays the same — col/row are grid coords, auto-scale
```

This already uses `TILE` for pixel positions, so it auto-scales.

**drawPostEffects scanlines:**
```typescript
    for (let y = 0; y < this.canvasH; y += 2) {
```
Keep `y += 2` — scanlines should be every 2 canvas pixels regardless of TILE size.

### Step 6: Run all pixel tests

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/`
Expected: All pass

### Step 7: Commit

```bash
git add apps/dashboard/src/components/pixel/engine/SceneManager.ts
git commit -m "feat(pixel): desk assignment, idle scheduling, 2× scene manager"
```

---

## Task 8: Bridge — Remove Drip-Feed

**Files:**
- Modify: `apps/dashboard/src/components/pixel/bridge/usePixelBridge.ts`
- Test: `apps/dashboard/src/__tests__/pixel/usePixelBridge.test.ts`

### Step 1: Simplify bridge

The drip-feed queue is no longer needed since agents persist and don't pop in/out rapidly. Replace the entire `usePixelBridge` function:

```typescript
import { useEffect, useRef } from 'react';
import { useAgentStore } from '../../../store/agentStore';
import type { SceneManager } from '../engine/SceneManager';
import { mapEventToCommands } from './eventMapper';

export { mapEventToCommands } from './eventMapper';

/** React hook: subscribes to store events, translates to scene commands, dispatches to SceneManager. */
export function usePixelBridge(sceneRef: React.RefObject<SceneManager | null>): void {
  const processedRef = useRef(new Set<string>());

  useEffect(() => {
    const unsub = useAgentStore.subscribe((state, prev) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const events = state.events;
      const prevEvents = prev.events;
      if (events === prevEvents) return;

      // Dispatch all new events immediately
      for (const event of events) {
        if (processedRef.current.has(event.id)) break;
        processedRef.current.add(event.id);
        const cmds = mapEventToCommands(event);
        for (const cmd of cmds) scene.handleCommand(cmd);
      }

      // Prevent memory growth
      if (processedRef.current.size > 2000) {
        const ids = events.map(e => e.id);
        processedRef.current = new Set(ids);
      }
    });

    return () => { unsub(); };
  }, [sceneRef]);
}
```

### Step 2: Run bridge tests

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/usePixelBridge.test.ts`
Expected: All 13 pass (they test `mapEventToCommands`, not the drip-feed queue)

### Step 3: Commit

```bash
git add apps/dashboard/src/components/pixel/bridge/usePixelBridge.ts
git commit -m "feat(pixel): remove drip-feed queue, direct dispatch"
```

---

## Task 9: DemoSequencer — 90s Loop with Idle

**Files:**
- Modify: `apps/dashboard/src/components/pixel/modes/DemoSequencer.ts`

### Step 1: Rewrite the demo schedule

Key changes:
- `loopDuration`: 35 → 90
- Agents spawn early and persist
- Gaps between tool calls show idle wandering/sitting
- Include socialize and coffee breaks

```typescript
export class DemoSequencer {
  private elapsed = 0;
  private cursor = 0;
  private schedule: ScheduledCommand[] = [];
  private loopDuration = 90;
  private running = false;

  // ... constructor, start, stop, update stay the same

  private buildSchedule(): void {
    const s = this.schedule;

    // t=1: Session start
    s.push({ time: 1, cmd: { type: 'sessionStart', sessionId: 'demo-session' } });

    // t=2: Prompt arrives
    s.push({ time: 2, cmd: { type: 'promptArrived', text: 'Fix the auth bug in login.ts', agentId: 'opus-1' } });

    // t=3: Opus spawns — will idle at desk until first tool call
    s.push({ time: 3, cmd: { type: 'spawnAgent', agentId: 'opus-1', model: 'claude-opus-4-6', agentType: 'root' } });

    // t=8: Opus → Read (idle for 5s first, then works 4s)
    s.push({ time: 8, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Read' } });
    s.push({ time: 12, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Read', success: true } });
    s.push({ time: 12, cmd: { type: 'cacheHit', agentId: 'opus-1' } });

    // t=12-18: Opus idles (sits at desk, maybe wanders) — automatic via idle system

    // t=18: Opus → Edit (6s gap, then 4s work)
    s.push({ time: 18, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Edit' } });
    s.push({ time: 22, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Edit', success: true } });

    // t=24: Opus → Task (spawns Sonnet)
    s.push({ time: 24, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Task' } });
    s.push({ time: 27, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Task', success: true } });

    // t=27: Sonnet spawns — idles while Opus continues
    s.push({ time: 27, cmd: { type: 'spawnAgent', agentId: 'sonnet-1', model: 'claude-sonnet-4-6', agentType: 'Explore', parentAgentId: 'opus-1' } });

    // t=30: Opus → Write (idle 3s, then 6s work)
    s.push({ time: 30, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Write' } });
    s.push({ time: 36, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Write', success: true } });

    // t=32: Sonnet → Grep (idle 5s after spawn, then 4s work)
    s.push({ time: 32, cmd: { type: 'dispatchToStation', agentId: 'sonnet-1', stationName: 'Grep' } });
    s.push({ time: 36, cmd: { type: 'stationComplete', agentId: 'sonnet-1', stationName: 'Grep', success: true } });

    // t=36-40: Both idle — they should wander/socialize with each other

    // t=40: Sonnet → Glob
    s.push({ time: 40, cmd: { type: 'dispatchToStation', agentId: 'sonnet-1', stationName: 'Glob' } });
    s.push({ time: 43, cmd: { type: 'stationComplete', agentId: 'sonnet-1', stationName: 'Glob', success: true } });
    s.push({ time: 43, cmd: { type: 'cacheHit', agentId: 'sonnet-1' } });

    // t=43: Haiku spawns
    s.push({ time: 43, cmd: { type: 'spawnAgent', agentId: 'haiku-1', model: 'claude-haiku-4-5', agentType: 'Bash', parentAgentId: 'sonnet-1' } });

    // t=45: Haiku → Bash (fast worker)
    s.push({ time: 45, cmd: { type: 'dispatchToStation', agentId: 'haiku-1', stationName: 'Bash' } });
    s.push({ time: 47, cmd: { type: 'stationComplete', agentId: 'haiku-1', stationName: 'Bash', success: true } });

    // t=48: Opus → Bash (error, while haiku idles)
    s.push({ time: 48, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Bash' } });
    s.push({ time: 51, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Bash', success: false } });

    // t=50: Haiku → Read, cache hit
    s.push({ time: 50, cmd: { type: 'dispatchToStation', agentId: 'haiku-1', stationName: 'Read' } });
    s.push({ time: 51.5, cmd: { type: 'stationComplete', agentId: 'haiku-1', stationName: 'Read', success: true } });
    s.push({ time: 51.5, cmd: { type: 'cacheHit', agentId: 'haiku-1' } });

    // t=53: Sonnet → Web
    s.push({ time: 53, cmd: { type: 'dispatchToStation', agentId: 'sonnet-1', stationName: 'Web' } });
    s.push({ time: 58, cmd: { type: 'stationComplete', agentId: 'sonnet-1', stationName: 'Web', success: true } });

    // t=55: Haiku finishes — despawn
    s.push({ time: 55, cmd: { type: 'tokenStream', agentId: 'haiku-1', count: 5 } });
    s.push({ time: 55, cmd: { type: 'despawnAgent', agentId: 'haiku-1', success: true } });
    s.push({ time: 55, cmd: { type: 'updateCost', costUsd: 0.05 } });

    // t=58-65: Opus and Sonnet idle together — wander, socialize, coffee

    // t=65: Opus → Read (final review)
    s.push({ time: 65, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Read' } });
    s.push({ time: 68, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Read', success: true } });

    // t=68: Sonnet finishes
    s.push({ time: 68, cmd: { type: 'tokenStream', agentId: 'sonnet-1', count: 8 } });
    s.push({ time: 68, cmd: { type: 'despawnAgent', agentId: 'sonnet-1', success: true } });
    s.push({ time: 68, cmd: { type: 'updateCost', costUsd: 0.12 } });

    // t=70: Opus → Write (final edit, alone now)
    s.push({ time: 70, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Write' } });
    s.push({ time: 75, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Write', success: true } });

    // t=75-80: Opus idles alone

    // t=80: Opus finishes
    s.push({ time: 80, cmd: { type: 'tokenStream', agentId: 'opus-1', count: 15 } });
    s.push({ time: 80, cmd: { type: 'despawnAgent', agentId: 'opus-1', success: true } });
    s.push({ time: 80, cmd: { type: 'updateCost', costUsd: 0.25 } });

    // t=82: Session end
    s.push({ time: 82, cmd: { type: 'sessionEnd', sessionId: 'demo-session' } });

    // Sort by time
    s.sort((a, b) => a.time - b.time);
  }
}
```

### Step 2: Run all pixel tests

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/`
Expected: All pass

### Step 3: Commit

```bash
git add apps/dashboard/src/components/pixel/modes/DemoSequencer.ts
git commit -m "feat(pixel): 90s demo loop with idle showcases"
```

---

## Task 10: TileMap, Pathfinding, and Remaining Test Updates

**Files:**
- Modify: `apps/dashboard/src/__tests__/pixel/TileMap.test.ts`
- Modify: `apps/dashboard/src/__tests__/pixel/pathfinding.test.ts`
- Modify: `apps/dashboard/src/__tests__/pixel/ParticleManager.test.ts` (if needed)

### Step 1: Update TileMap tests

The TileMap tests use grid coordinates (col, row), not pixel values — they should pass unchanged. Verify:

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/TileMap.test.ts`
Expected: All 7+ pass (all assertions use grid coords)

### Step 2: Update pathfinding tests

The pathfinding tests use a custom 5×5 grid, not TILE. They should pass unchanged:

Run: `cd apps/dashboard && npx vitest run src/__tests__/pixel/pathfinding.test.ts`
Expected: All 6 pass

### Step 3: Run full test suite

Run: `cd apps/dashboard && npx vitest run`
Expected: All tests pass

### Step 4: Commit any remaining test fixes

```bash
git add -A apps/dashboard/src/__tests__/pixel/
git commit -m "test(pixel): update all pixel tests for TILE=32"
```

---

## Task 11: Visual Verification & Polish

**Files:** None (manual testing)

### Step 1: Start the dev servers

```bash
# Terminal 1
npx tsx packages/server/src/index.ts
# Terminal 2
cd apps/dashboard && npx vite
```

### Step 2: Open pixel view

Navigate to `http://localhost:5173/?view=pixel`

### Step 3: Test demo mode

Click gear icon → Settings → Demo mode. Verify:
- Canvas is noticeably larger/sharper
- Agents spawn at door, walk to desks
- Agents sit at desks, wander around, visit coffee machine
- Agents walk to stations when tool calls arrive
- Agents return to idle after tool completes
- Socializing works when 2+ agents are idle
- Loop completes at ~90s and restarts cleanly

### Step 4: Test live mode with simulation

Switch back to Live mode, then run:
```bash
npx tsx scripts/simulate_all_nodes.ts
```

Verify agents spawn, persist, work at stations, and despawn cleanly.

### Step 5: Fix any visual issues found

Common things to check:
- Characters not clipping through stations
- Walk paths look natural
- Labels readable at 2× size
- Particles not too large/small
- HUD overlay still positioned correctly over larger canvas

### Step 6: Final commit

```bash
git add -A
git commit -m "feat(pixel): HD upgrade complete — 2× resolution + persistent agents"
```

---

## Summary of All Files Changed

| # | File | Change Type |
|---|------|-------------|
| 1 | `engine/types.ts` | TILE=32, new types (DeskDef, PointOfInterestDef, IdleBehavior) |
| 2 | `themes/retro-office.ts` | 2× model dims, homeDesks, pointsOfInterest |
| 3 | `engine/Character.ts` | S-factor scaling, idle system (pickIdleBehavior, idleTimer, homeDesk) |
| 4 | `engine/Station.ts` | S-factor scaling all draw code |
| 5 | `engine/Decoration.ts` | S-factor scaling all draw code |
| 6 | `engine/ParticleManager.ts` | S-factor scaling sizes and velocities |
| 7 | `engine/SceneManager.ts` | Desk assignment, idle scheduling, handleCommand updates |
| 8 | `bridge/usePixelBridge.ts` | Remove drip-feed queue |
| 9 | `modes/DemoSequencer.ts` | 90s loop with idle showcases |
| 10 | `__tests__/pixel/types.test.ts` | TILE=32 test, homeDesks/pointsOfInterest tests |
| 11 | `__tests__/pixel/Character.test.ts` | TILE-based coords, idle behavior tests |
| 12 | `__tests__/pixel/Station.test.ts` | TILE-based coords |
| 13 | `__tests__/pixel/TileMap.test.ts` | Likely unchanged (grid coords) |
| 14 | `__tests__/pixel/pathfinding.test.ts` | Likely unchanged (custom grid) |
| 15 | `__tests__/pixel/ParticleManager.test.ts` | Likely unchanged (counts/lifecycle) |
| 16 | `__tests__/pixel/usePixelBridge.test.ts` | Likely unchanged (tests mapEventToCommands) |

**No new files created.** All changes are modifications to existing files.
