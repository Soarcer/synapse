// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { StationDef, Palette } from './types';
import { TILE } from './types';

export class Station {
  readonly name: string;
  readonly col: number;
  readonly row: number;
  readonly icon: string;
  active = false;
  activeTime = 0;
  glowAlpha = 0;

  private palette: Palette;

  constructor(def: StationDef, palette: Palette) {
    this.name = def.name;
    this.col = def.col;
    this.row = def.row;
    this.icon = def.icon;
    this.palette = palette;
  }

  get px(): number { return this.col * TILE; }
  get py(): number { return this.row * TILE; }

  activate(): void {
    this.active = true;
    this.activeTime = 0;
  }

  deactivate(): void {
    this.active = false;
  }

  update(dt: number): void {
    if (this.active) {
      this.activeTime += dt;
      this.glowAlpha = 0.3 + 0.2 * Math.sin(this.activeTime * 4);
    } else {
      this.glowAlpha *= 0.9;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const x = this.px, y = this.py;
    const p = this.palette;
    const T = TILE;
    const S = T / 16;

    // Glow
    if (this.glowAlpha > 0.01) {
      ctx.globalAlpha = this.glowAlpha;
      ctx.fillStyle = this.icon === 'terminal' ? '#33ff33' :
                      this.icon === 'bookshelf' ? '#ff8844' :
                      this.icon === 'globe' ? '#3090b0' : p.gold;
      ctx.fillRect(x - 3 * S, y - 3 * S, T * 2 + 6 * S, T * 2 + 6 * S);
      ctx.globalAlpha = 1;
    }

    // Desk base
    ctx.fillStyle = p.desk[1];
    ctx.fillRect(x - S, y + T * 2 - 4 * S, T * 2 + 2 * S, 5 * S);
    ctx.fillStyle = p.desk[0];
    ctx.fillRect(x, y + T * 2 - 5 * S, T * 2, 5 * S);

    // Station icon
    this.drawIcon(ctx, x, y, T);

    // Label
    ctx.fillStyle = '#888';
    ctx.font = `${6 * S}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(this.name, x + T, y + T * 2 + 6 * S);
  }

  private drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, T: number): void {
    const t = this.activeTime;
    const p = this.palette;
    const S = T / 16;

    switch (this.icon) {
      case 'terminal': {
        ctx.fillStyle = '#444';
        ctx.fillRect(x + 2 * S, y, T * 2 - 4 * S, T + 8 * S);
        ctx.fillStyle = '#0c0c1c';
        ctx.fillRect(x + 4 * S, y + 2 * S, T * 2 - 8 * S, T + 4 * S);
        const green = this.active ? '#33ff33' : '#116611';
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = green;
          const w = this.active ? (8 * S + ((t * 30 + i * 7) % 12) * S) : (6 + i * 2) * S;
          const ox = this.active ? Math.floor(Math.sin(t * 3 + i) * 2 * S) : 0;
          ctx.fillRect(x + 6 * S + ox, y + 4 * S + i * 3 * S, Math.min(w, T * 2 - 12 * S), 2 * S);
        }
        ctx.fillStyle = '#555';
        ctx.fillRect(x + T - 2 * S, y + T + 8 * S, 4 * S, 4 * S);
        break;
      }
      case 'cabinet': {
        ctx.fillStyle = '#7b5520';
        ctx.fillRect(x + 4 * S, y, T * 2 - 8 * S, T * 2 - 6 * S);
        ctx.fillStyle = '#a07830';
        for (let i = 0; i < 3; i++) {
          const dy = y + 2 * S + i * 7 * S;
          const open = this.active && i === 0 ? 4 * S : 0;
          ctx.fillRect(x + 6 * S - open, dy, T * 2 - 12 * S, 6 * S);
          ctx.fillStyle = p.gold;
          ctx.fillRect(x + T - S, dy + 2 * S, 3 * S, 2 * S);
          ctx.fillStyle = '#a07830';
        }
        if (this.active) {
          ctx.fillStyle = '#f0ece0';
          ctx.fillRect(x + 2 * S, y + S, 6 * S, 8 * S);
          ctx.fillRect(x + 4 * S, y - 2 * S, 4 * S, 6 * S);
        }
        break;
      }
      case 'typewriter': {
        ctx.fillStyle = '#888888';
        ctx.fillRect(x + 3 * S, y + 6 * S, T * 2 - 6 * S, T - 2 * S);
        const paperH = this.active ? (T + Math.floor(t * 4) % 6 * S) : T;
        ctx.fillStyle = '#f0ece0';
        ctx.fillRect(x + 8 * S, y + 6 * S - Math.min(paperH, T + 4 * S), 14 * S, Math.min(paperH, T + 4 * S));
        if (this.active) {
          ctx.fillStyle = '#333';
          for (let i = 0; i < 3; i++) {
            ctx.fillRect(x + 10 * S, y + 2 * S - Math.min(paperH, T) + 4 * S + i * 3 * S, (8 - i) * S, S);
          }
        }
        ctx.fillStyle = '#555';
        for (let i = 0; i < 5; i++) {
          const kx = x + 5 * S + i * 4 * S + (this.active && Math.sin(t * 10 + i * 2) > 0.7 ? -S : 0);
          ctx.fillRect(kx, y + T, 3 * S, 2 * S);
        }
        ctx.fillStyle = '#666';
        const cx = this.active ? x + 3 * S + Math.floor(t * 8) % (T * 2 - 8 * S) : x + 3 * S;
        ctx.fillRect(cx, y + 4 * S, 4 * S, 2 * S);
        break;
      }
      case 'drafting': {
        ctx.fillStyle = '#9b8060';
        ctx.beginPath();
        ctx.moveTo(x + 2 * S, y + T + 4 * S);
        ctx.lineTo(x + 6 * S, y + 2 * S);
        ctx.lineTo(x + T * 2 - 4 * S, y + 2 * S);
        ctx.lineTo(x + T * 2 - 2 * S, y + T + 4 * S);
        ctx.fill();
        ctx.fillStyle = '#f0ece0';
        ctx.fillRect(x + 8 * S, y + 3 * S, 14 * S, 12 * S);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = this.active ? (i < Math.floor(t * 2) % 4 ? p.success : p.error) : '#ddd';
          ctx.fillRect(x + 10 * S, y + 5 * S + i * 3 * S, 10 * S, S);
        }
        const pencilX = this.active ? x + 10 * S + Math.sin(t * 5) * 4 * S : x + T * 2 - 8 * S;
        ctx.fillStyle = '#ffe040';
        ctx.fillRect(pencilX, y + S, 2 * S, 10 * S);
        ctx.fillStyle = '#333';
        ctx.fillRect(pencilX, y + 10 * S, 2 * S, 2 * S);
        break;
      }
      case 'magnifier': {
        for (let i = 0; i < 3; i++) {
          const glow = this.active && i === Math.floor(t * 2) % 3;
          ctx.fillStyle = glow ? '#88bbff' : '#8b7b5b';
          ctx.fillRect(x + 4 * S + i * 8 * S, y + 8 * S, 7 * S, 10 * S);
          ctx.fillStyle = glow ? '#aaddff' : '#a09080';
          ctx.fillRect(x + 5 * S + i * 8 * S, y + 8 * S, 5 * S, 2 * S);
        }
        const mgx = this.active ? x + 8 * S + Math.sin(t * 3) * 6 * S : x + 12 * S;
        ctx.strokeStyle = '#8b6b4b';
        ctx.lineWidth = 2 * S;
        ctx.beginPath();
        ctx.arc(mgx + 4 * S, y + 4 * S, 5 * S, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mgx + 8 * S, y + 8 * S);
        ctx.lineTo(mgx + 12 * S, y + 12 * S);
        ctx.stroke();
        if (this.active) {
          ctx.fillStyle = 'rgba(136,204,255,0.2)';
          ctx.beginPath();
          ctx.arc(mgx + 4 * S, y + 4 * S, 4 * S, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.lineWidth = S;
        break;
      }
      case 'bookshelf': {
        const bookColors = ['#cc4444', '#4488cc', '#44aa44', '#cc8844', '#8844aa'];
        ctx.fillStyle = '#5b2a10';
        ctx.fillRect(x + 2 * S, y, T * 2 - 4 * S, T * 2 - 6 * S);
        for (let sh = 0; sh < 2; sh++) {
          ctx.fillStyle = '#4a2008';
          ctx.fillRect(x + 2 * S, y + 10 * S + sh * 10 * S, T * 2 - 4 * S, 2 * S);
          for (let b = 0; b < 5; b++) {
            const slideOut = this.active && sh === 0 && b === Math.floor(t * 1.5) % 5;
            ctx.fillStyle = bookColors[b % bookColors.length];
            ctx.fillRect(x + 4 * S + b * 5 * S, y + 2 * S + sh * 10 * S - (slideOut ? 3 * S : 0), 4 * S, 8 * S);
          }
        }
        if (this.active) {
          ctx.fillStyle = 'rgba(255,200,100,0.15)';
          ctx.beginPath();
          ctx.moveTo(x + T, y - 2 * S);
          ctx.lineTo(x + 2 * S, y + T * 2 - 8 * S);
          ctx.lineTo(x + T * 2 - 2 * S, y + T * 2 - 8 * S);
          ctx.fill();
        }
        break;
      }
      case 'globe': {
        const gcx = x + T, gcy = y + 8 * S;
        ctx.fillStyle = '#666';
        ctx.fillRect(gcx - S, gcy + 7 * S, 3 * S, 6 * S);
        ctx.fillRect(gcx - 4 * S, gcy + 12 * S, 9 * S, 2 * S);
        const rot = this.active ? t * 2 : 0;
        ctx.fillStyle = '#3090b0';
        ctx.beginPath();
        ctx.arc(gcx, gcy, 7 * S, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#60c8e0';
        ctx.lineWidth = S;
        ctx.beginPath();
        ctx.arc(gcx, gcy, 7 * S, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(gcx, gcy, 3 * S + Math.sin(rot) * 2 * S, 7 * S, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gcx - 7 * S, gcy);
        ctx.lineTo(gcx + 7 * S, gcy);
        ctx.stroke();
        if (this.active) {
          for (let w = 0; w < 3; w++) {
            const r = 10 * S + w * 5 * S + (t * 15) % 8 * S;
            ctx.globalAlpha = Math.max(0, 1 - r / (30 * S));
            ctx.strokeStyle = '#60c8e0';
            ctx.beginPath();
            ctx.arc(gcx, gcy - 4 * S, r, -Math.PI * 0.7, -Math.PI * 0.3);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'dispatch': {
        ctx.fillStyle = p.desk[0];
        ctx.fillRect(x + 2 * S, y + 6 * S, T * 2 - 4 * S, T);
        const ring = this.active && Math.sin(t * 20) > 0.5;
        ctx.fillStyle = '#222';
        ctx.fillRect(x + 6 * S + (ring ? S : 0), y + 8 * S, 8 * S, 4 * S);
        ctx.fillRect(x + 4 * S + (ring ? -S : 0), y + 7 * S, 4 * S, 6 * S);
        ctx.fillRect(x + 12 * S + (ring ? S : 0), y + 7 * S, 4 * S, 6 * S);
        ctx.strokeStyle = '#444';
        ctx.beginPath();
        ctx.moveTo(x + 14 * S, y + 12 * S);
        for (let i = 0; i < 4; i++) {
          ctx.lineTo(x + 16 * S + i * 2 * S, y + 12 * S + (i % 2 ? 2 * S : -S));
        }
        ctx.stroke();
        for (let pp = 0; pp < 3; pp++) {
          ctx.fillStyle = pp === 0 ? '#f0ece0' : '#e8e4d8';
          ctx.fillRect(x + T + 4 * S, y + 8 * S + pp * 2 * S, 8 * S, 5 * S);
        }
        break;
      }
    }
  }
}
