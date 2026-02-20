import type { PixelTheme, SceneCommand } from './types';
import { TILE } from './types';
import { TileMap } from './TileMap';
import { Station } from './Station';
import { Character } from './Character';
import { ParticleManager } from './ParticleManager';
import { drawDecoration } from './Decoration';

export interface ClickTarget {
  type: 'character' | 'station' | 'none';
  agentId?: string;
  stationName?: string;
  x: number;
  y: number;
}

export class SceneManager {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private canvasW: number;
  private canvasH: number;

  readonly theme: PixelTheme;
  readonly tileMap: TileMap;
  readonly stations: Station[];
  private stationByName: Map<string, Station>;
  readonly characters: Map<string, Character> = new Map();
  readonly particles: ParticleManager;
  readonly manager: Character;

  private gameTime = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  currentCost = 0;
  onClickTarget: ((target: ClickTarget) => void) | null = null;

  // Called externally by DemoSequencer or ReplayController
  onUpdate: ((dt: number) => void) | null = null;

  constructor(private container: HTMLElement, theme: PixelTheme) {
    this.theme = theme;
    this.canvasW = theme.grid.cols * TILE;
    this.canvasH = theme.grid.rows * TILE;

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.style.display = 'block';
    this.canvas.style.border = '2px solid #2a2a3a';
    this.canvas.style.borderRadius = '3px';
    this.canvas.style.boxShadow = '0 0 60px rgba(40,30,20,0.4), inset 0 0 80px rgba(0,0,0,0.1)';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Build scene elements
    this.tileMap = new TileMap(theme);
    this.stations = theme.stations.map(d => new Station(d, theme.palette));
    this.stationByName = new Map(this.stations.map(s => [s.name, s]));
    this.particles = new ParticleManager();

    // Manager character (invisible initially)
    const mgrConfig = theme.models.manager ?? theme.models.sonnet;
    this.manager = new Character(theme.door.col, 2, 'manager', mgrConfig, '__manager__');
    this.manager.alpha = 0;

    // Events
    this.canvas.addEventListener('click', this.handleClick);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  // ── Public API ──

  start(): void {
    if (this.running) return;
    this.running = true;
    this.rafId = requestAnimationFrame((ts) => {
      this.lastTime = ts;
      this.rafId = requestAnimationFrame(this.loop);
    });
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  destroy(): void {
    this.stop();
    this.canvas.removeEventListener('click', this.handleClick);
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }

  getActiveAgentCount(): number { return this.characters.size; }
  getCurrentCost(): number { return this.currentCost; }

  getCharacterAt(canvasX: number, canvasY: number): Character | null {
    for (const ch of this.characters.values()) {
      if (Math.abs(canvasX - ch.x) < ch.w && Math.abs(canvasY - ch.y) < ch.h) return ch;
    }
    return null;
  }

  getStationAt(canvasX: number, canvasY: number): Station | null {
    for (const s of this.stations) {
      if (canvasX >= s.col * TILE && canvasX < (s.col + 2) * TILE &&
          canvasY >= s.row * TILE && canvasY < (s.row + 2) * TILE) return s;
    }
    return null;
  }

  // ── Scene Commands ──

  handleCommand(cmd: SceneCommand): void {
    switch (cmd.type) {
      case 'spawnAgent': {
        const modelKey = this.resolveModel(cmd.model);
        const config = this.theme.models[modelKey] ?? this.theme.models.sonnet;
        const { col, row } = this.theme.spawnArea;
        const ch = new Character(col, row, modelKey, config, cmd.agentId);
        ch.agentType = cmd.agentType;
        ch.state = 'spawning';
        ch.alpha = 0;
        ch.onDust = (dx, dy) => this.particles.emit('dust', dx, dy, 1);
        this.characters.set(cmd.agentId, ch);
        this.particles.emit('sparkle', ch.x, ch.y, 12);
        break;
      }
      case 'despawnAgent': {
        const ch = this.characters.get(cmd.agentId);
        if (!ch) break;
        ch.state = 'despawning';
        ch.statusIcon = cmd.success ? '✓' : '!';
        ch.statusTimer = 1.5;
        this.particles.emit(cmd.success ? 'sparkle' : 'error', ch.x, ch.y, 8);
        setTimeout(() => this.characters.delete(cmd.agentId), 3000);
        break;
      }
      case 'dispatchToStation': {
        const ch = this.characters.get(cmd.agentId);
        const station = this.stationByName.get(cmd.stationName);
        if (!ch || !station) break;
        const approach = this.tileMap.getApproachTile(station);
        ch.moveTo(approach.c, approach.r, this.tileMap.getWalkabilityGrid(), () => {
          ch.state = 'working';
          ch.dir = 'up';
          station.activate();
        });
        break;
      }
      case 'stationComplete': {
        const ch = this.characters.get(cmd.agentId);
        const station = this.stationByName.get(cmd.stationName);
        if (station) station.deactivate();
        if (ch) ch.state = 'idle';
        break;
      }
      case 'promptArrived':
        this.managerDeliver(cmd.text, cmd.agentId);
        break;
      case 'tokenStream': {
        const { col, row } = this.theme.outputStation;
        this.particles.emit('token', (col + 1) * TILE, (row + 1) * TILE, cmd.count);
        break;
      }
      case 'cacheHit': {
        const ch = this.characters.get(cmd.agentId);
        if (ch) this.particles.emit('cache', ch.x, ch.y, 5);
        break;
      }
      case 'updateCost':
        this.currentCost = cmd.costUsd;
        break;
      case 'sessionStart':
        // Reset state for new session
        this.characters.clear();
        this.currentCost = 0;
        break;
      case 'sessionEnd':
        break;
    }
  }

  // ── Private ──

  private resolveModel(modelStr: string): string {
    const lower = modelStr.toLowerCase();
    if (lower.includes('opus')) return 'opus';
    if (lower.includes('haiku')) return 'haiku';
    if (lower.includes('sonnet')) return 'sonnet';
    return 'sonnet'; // default
  }

  private managerDeliver(promptText: string, targetAgentId: string): void {
    const grid = this.tileMap.getWalkabilityGrid();
    this.manager.alpha = 1;
    this.manager.col = this.theme.door.col;
    this.manager.row = 2;
    this.manager.x = this.manager.col * TILE + TILE / 2;
    this.manager.y = 2 * TILE + TILE / 2;
    this.manager.carryPaper = true;
    this.manager.state = 'idle';
    this.manager.onDust = (dx, dy) => this.particles.emit('dust', dx, dy, 1);

    this.manager.moveTo(this.theme.spawnArea.col, 10, grid, () => {
      this.manager.carryPaper = false;
      const target = this.characters.get(targetAgentId);
      if (target) target.carryPaper = true;
      this.manager.moveTo(this.theme.door.col, 2, grid, () => {
        this.manager.alpha = 0;
      });
    });
  }

  private loop = (timestamp: number): void => {
    if (!this.running) return;
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;
    this.gameTime += dt;

    // External update hook (demo/replay)
    if (this.onUpdate) this.onUpdate(dt);

    // Update
    for (const s of this.stations) s.update(dt);
    this.characters.forEach(ch => ch.update(dt));
    if (this.manager.alpha > 0) this.manager.update(dt);
    this.particles.update(dt);

    // Draw
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    this.tileMap.draw(ctx);

    // Decorations
    for (const d of this.theme.decorations) {
      drawDecoration(ctx, d, this.theme.palette, this.gameTime, this.particles, this.currentCost);
    }

    // Stations sorted by Y for depth
    const sortedStations = [...this.stations].sort((a, b) => a.row - b.row);
    for (const s of sortedStations) s.draw(ctx);

    // Characters sorted by Y for depth
    const chars = [...this.characters.values()];
    if (this.manager.alpha > 0) chars.push(this.manager);
    chars.sort((a, b) => a.y - b.y);
    for (const ch of chars) ch.draw(ctx);

    // Particles on top
    this.particles.draw(ctx);

    // Post-effects
    this.drawPostEffects(ctx);

    this.rafId = requestAnimationFrame(this.loop);
  };

  private drawPostEffects(ctx: CanvasRenderingContext2D): void {
    // Scanline overlay
    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    for (let y = 0; y < this.canvasH; y += 2) {
      ctx.fillRect(0, y, this.canvasW, 1);
    }
    // Vignette
    const grad = ctx.createRadialGradient(
      this.canvasW / 2, this.canvasH / 2, this.canvasH * 0.4,
      this.canvasW / 2, this.canvasH / 2, this.canvasH * 0.8,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.canvasW, this.canvasH);
  }

  private resize = (): void => {
    const rect = this.container.getBoundingClientRect();
    const scale = Math.min(rect.width / this.canvasW, rect.height / this.canvasH) * 0.98;
    this.canvas.style.width = `${this.canvasW * scale}px`;
    this.canvas.style.height = `${this.canvasH * scale}px`;
  };

  private handleClick = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvasW / rect.width;
    const scaleY = this.canvasH / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    // Check characters first
    for (const ch of this.characters.values()) {
      if (Math.abs(cx - ch.x) < ch.w && Math.abs(cy - ch.y) < ch.h) {
        this.onClickTarget?.({ type: 'character', agentId: ch.agentId, x: e.clientX, y: e.clientY });
        return;
      }
    }
    // Check stations
    for (const s of this.stations) {
      if (cx >= s.col * TILE && cx < (s.col + 2) * TILE &&
          cy >= s.row * TILE && cy < (s.row + 2) * TILE) {
        this.onClickTarget?.({ type: 'station', stationName: s.name, x: e.clientX, y: e.clientY });
        return;
      }
    }
    this.onClickTarget?.({ type: 'none', x: 0, y: 0 });
  };
}
