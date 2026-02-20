import type { ModelConfig, CharacterState, Direction } from './types';
import { TILE } from './types';
import { findPath, type PathNode } from './pathfinding';

export class Character {
  col: number;
  row: number;
  x: number;
  y: number;
  readonly model: string;
  readonly w: number;
  readonly h: number;
  readonly speed: number;
  readonly bodyColor: string;
  readonly accentColor: string;
  readonly label: string;
  readonly agentId: string;
  agentType = 'general-purpose';

  state: CharacterState = 'idle';
  dir: Direction = 'down';
  walkFrame = 0;
  private walkDist = 0;
  path: PathNode[] | null = null;
  private pathIdx = 0;
  private tx: number;
  private ty: number;
  private onArrive: (() => void) | null = null;

  alpha = 1;
  spawnTimer = 0;
  despawnTimer = 0;
  stateTime = 0;

  statusIcon: string | null = null;
  statusTimer = 0;
  carryPaper = false;
  private bobOffset: number;

  // Callback for dust particles — set by SceneManager
  onDust: ((x: number, y: number) => void) | null = null;

  constructor(col: number, row: number, model: string, config: ModelConfig, agentId: string) {
    this.col = col;
    this.row = row;
    this.x = col * TILE + TILE / 2;
    this.y = row * TILE + TILE / 2;
    this.tx = this.x;
    this.ty = this.y;
    this.model = model;
    this.w = config.width;
    this.h = config.height;
    this.speed = config.speed;
    this.bodyColor = config.bodyColor;
    this.accentColor = config.accentColor;
    this.label = config.label;
    this.agentId = agentId;
    this.bobOffset = Math.random() * Math.PI * 2;
  }

  moveTo(tc: number, tr: number, walkable: boolean[][], cb?: () => void): void {
    const path = findPath(walkable, this.col, this.row, tc, tr);
    if (!path || path.length < 2) {
      this.col = tc;
      this.row = tr;
      if (cb) cb();
      return;
    }
    this.path = path;
    this.pathIdx = 1;
    this.state = 'walking';
    this.onArrive = cb ?? null;
    this.setNextTarget();
  }

  private setNextTarget(): void {
    if (!this.path || this.pathIdx >= this.path.length) {
      if (this.path) {
        const last = this.path[this.path.length - 1];
        this.col = last.c;
        this.row = last.r;
      }
      this.state = 'idle';
      this.path = null;
      if (this.onArrive) {
        const cb = this.onArrive;
        this.onArrive = null;
        cb();
      }
      return;
    }
    const next = this.path[this.pathIdx];
    this.tx = next.c * TILE + TILE / 2;
    this.ty = next.r * TILE + TILE / 2;
    const dx = this.tx - this.x, dy = this.ty - this.y;
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? 'right' : 'left';
    else this.dir = dy > 0 ? 'down' : 'up';
  }

  update(dt: number): void {
    this.stateTime += dt;
    if (this.statusTimer > 0) {
      this.statusTimer -= dt;
      if (this.statusTimer <= 0) this.statusIcon = null;
    }

    switch (this.state) {
      case 'spawning':
        this.spawnTimer += dt;
        this.alpha = Math.min(1, this.spawnTimer / 0.5);
        if (this.spawnTimer >= 0.5) {
          this.state = 'idle';
          this.alpha = 1;
        }
        break;

      case 'despawning':
        this.despawnTimer += dt;
        this.alpha = Math.max(0, 1 - this.despawnTimer / 0.8);
        break;

      case 'walking': {
        const dx = this.tx - this.x, dy = this.ty - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = this.speed * dt;
        if (dist <= step) {
          this.x = this.tx;
          this.y = this.ty;
          if (this.path) {
            this.col = this.path[this.pathIdx].c;
            this.row = this.path[this.pathIdx].r;
          }
          this.pathIdx++;
          this.setNextTarget();
          if (Math.random() < 0.3 && this.onDust) {
            this.onDust(this.x, this.y + this.h / 2);
          }
        } else {
          this.x += (dx / dist) * step;
          this.y += (dy / dist) * step;
        }
        this.walkDist += step;
        this.walkFrame = Math.floor(this.walkDist / 6) % 4;
        break;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.alpha <= 0) return;
    ctx.globalAlpha = this.alpha;
    const x = Math.floor(this.x), y = Math.floor(this.y);
    const hw = this.w / 2, hh = this.h / 2;
    const bob = this.state === 'walking'
      ? Math.sin(this.walkDist * 0.5) * 1
      : Math.sin((this.stateTime + this.bobOffset) * 1.5) * 0.5;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + hh + 1, hw * 0.8, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Spawn sparkles
    if (this.state === 'spawning') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + this.spawnTimer * 4;
        const r = (1 - this.spawnTimer / 0.5) * 16;
        ctx.fillStyle = '#ffffaa';
        ctx.fillRect(x + Math.cos(a) * r - 1, y + Math.sin(a) * r - 1, 2, 2);
      }
    }

    // Feet (walk animation)
    const legSpread = this.state === 'walking' ? Math.sin(this.walkFrame * Math.PI / 2) * 2 : 0;
    ctx.fillStyle = '#333';
    ctx.fillRect(x - hw / 2 - 1, y + hh - 3 + bob, 2, 3);
    ctx.fillRect(x + hw / 2 - 1 + legSpread, y + hh - 3 + bob, 2, 3);

    // Body
    ctx.fillStyle = this.bodyColor;
    const bodyH = this.h * 0.45;
    ctx.fillRect(x - hw / 2, y + hh - bodyH - 2 + bob, hw, bodyH);

    // Model-specific details
    if (this.model === 'opus') {
      ctx.fillStyle = this.accentColor;
      ctx.fillRect(x - hw / 2, y + hh - 5 + bob, hw, 2);
      ctx.fillStyle = this.bodyColor;
      ctx.fillRect(x - hw / 2 - 1, y + hh - 7 + bob, hw + 2, 3);
    }
    if (this.model === 'manager') {
      ctx.fillStyle = this.accentColor;
      ctx.fillRect(x - 1, y + hh - bodyH + 2 + bob, 2, bodyH - 4);
    }

    // Head
    const headR = this.w * 0.25;
    const headY = y + hh - bodyH - headR - 2 + bob;
    ctx.fillStyle = '#f0c8a0';
    ctx.beginPath();
    ctx.arc(x, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // Eyes (direction-dependent)
    ctx.fillStyle = '#333';
    const eyeY = headY - 1;
    if (this.dir === 'left') {
      ctx.fillRect(x - headR + 1, eyeY, 1, 1);
      ctx.fillRect(x - 1, eyeY, 1, 1);
    } else if (this.dir === 'right') {
      ctx.fillRect(x + headR - 2, eyeY, 1, 1);
      ctx.fillRect(x, eyeY, 1, 1);
    } else {
      ctx.fillRect(x - 2, eyeY, 1, 1);
      ctx.fillRect(x + 1, eyeY, 1, 1);
    }

    // Opus hat/crown
    if (this.model === 'opus') {
      ctx.fillStyle = this.accentColor;
      ctx.fillRect(x - headR - 1, headY - headR - 2, headR * 2 + 2, 3);
      ctx.fillRect(x - headR, headY - headR - 4, 2, 3);
      ctx.fillRect(x - 1, headY - headR - 5, 2, 4);
      ctx.fillRect(x + headR - 2, headY - headR - 4, 2, 3);
    }

    // Haiku headband
    if (this.model === 'haiku') {
      ctx.fillStyle = this.accentColor;
      ctx.fillRect(x - headR, headY - 1, headR * 2, 1);
    }

    // Carry paper
    if (this.carryPaper) {
      ctx.fillStyle = '#f0ece0';
      const paperX = this.dir === 'left' ? x - hw - 3 : x + hw / 2;
      ctx.fillRect(paperX, y + bob, 5, 6);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(paperX + 1, y + 1 + bob, 3, 1);
      ctx.fillRect(paperX + 1, y + 3 + bob, 2, 1);
    }

    // Working indicator (... dots)
    if (this.state === 'working') {
      const dotPhase = Math.floor(this.stateTime * 3) % 4;
      ctx.fillStyle = '#fff';
      for (let d = 0; d < 3; d++) {
        if (d <= dotPhase) {
          ctx.fillRect(x - 3 + d * 3, headY - headR - 8, 2, 2);
        }
      }
    }

    // Status icon
    if (this.statusIcon === '!' && this.statusTimer > 0) {
      ctx.fillStyle = '#ff4444';
      ctx.fillRect(x - 1, headY - headR - 10, 3, 6);
      ctx.fillRect(x - 1, headY - headR - 3, 3, 2);
    }
    if (this.statusIcon === '✓' && this.statusTimer > 0) {
      ctx.fillStyle = '#44dd44';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('✓', x, headY - headR - 4);
    }

    // Name label
    ctx.fillStyle = this.accentColor;
    ctx.font = '5px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.label, x, y - hh - 3 + bob);

    ctx.globalAlpha = 1;
  }
}
