// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ── Particle system ──────────────────────────────────────────

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

export function spawnBurst(x: number, y: number, color: string, count = 12): Particle[] {
  return Array.from({ length: count }, () => ({
    x,
    y,
    vx: (Math.random() - 0.5) * 6,
    vy: (Math.random() - 0.5) * 6 - 2, // upward bias
    life: 1,
    color,
    size: Math.random() * 3 + 1,
  }));
}

export function updateParticles(particles: Particle[], dt: number): Particle[] {
  const alive: Particle[] = [];
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 4 * dt; // gravity
    p.life -= dt * 2; // fade over ~0.5s
    if (p.life > 0) alive.push(p);
  }
  return alive;
}

export function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

// ── Tool point values (rarer tools = more points) ───────────

const TOOL_POINTS: Record<string, number> = {
  Read: 10,
  Grep: 15,
  Bash: 15,
  Edit: 25,
  Write: 30,
  Glob: 30,
  WebSearch: 50,
  WebFetch: 50,
  TodoWrite: 75,
  Task: 100,
};
const DEFAULT_POINTS = 40;

export function getToolPoints(toolName: string): number {
  return TOOL_POINTS[toolName] ?? DEFAULT_POINTS;
}

// ── Score computation ────────────────────────────────────────

export interface ScoreState {
  score: number;
  combo: number;
  comboLabel?: string;
  lastStatus: 'success' | 'error' | 'running' | null;
}

/** Generic arcade scoring (used when no mode-specific scorer is provided). */
export function computeScore(statuses: Array<'success' | 'error' | 'running'>): ScoreState {
  let score = 0;
  let combo = 0;
  let lastStatus: ScoreState['lastStatus'] = null;

  for (const status of statuses) {
    if (status === 'success') {
      combo++;
      score += 100 + combo * 50;
    } else if (status === 'error') {
      combo = 0;
    }
    if (status !== 'running') lastStatus = status;
  }

  return { score, combo, comboLabel: 'COMBO!', lastStatus };
}

// ── 8-bit sound ──────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  // Resume if suspended (browser policy: requires user gesture to have happened)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {
      /* ignore */
    });
  }
  return audioCtx;
}

/** Close the shared AudioContext to release hardware audio session. */
export function closeAudioCtx() {
  if (audioCtx) {
    audioCtx.close().catch(() => {
      /* ignore */
    });
    audioCtx = null;
  }
}

export function playChirp(volume: number) {
  if (volume <= 0) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(660, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
  gain.gain.setValueAtTime((volume / 100) * 0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.1);
}

export function playBuzz(volume: number) {
  if (volume <= 0) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120, ctx.currentTime);
  gain.gain.setValueAtTime((volume / 100) * 0.12, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}

export function playCombo(volume: number) {
  if (volume <= 0) return;
  const ctx = getAudioCtx();
  const notes = [523, 659, 784]; // C5 E5 G5
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(notes[i], ctx.currentTime + i * 0.05);
    gain.gain.setValueAtTime((volume / 100) * 0.1, ctx.currentTime + i * 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.05 + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.05);
    osc.stop(ctx.currentTime + i * 0.05 + 0.15);
  }
}

// ── Pixel font loader ────────────────────────────────────────

let fontLoaded = false;

export function ensurePixelFont() {
  if (fontLoaded) return;
  fontLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap';
  document.head.appendChild(link);
}
