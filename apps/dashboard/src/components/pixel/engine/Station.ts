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

    // Glow
    if (this.glowAlpha > 0.01) {
      ctx.globalAlpha = this.glowAlpha;
      ctx.fillStyle = this.icon === 'terminal' ? '#33ff33' :
                      this.icon === 'bookshelf' ? '#ff8844' :
                      this.icon === 'globe' ? '#3090b0' : p.gold;
      ctx.fillRect(x - 3, y - 3, T * 2 + 6, T * 2 + 6);
      ctx.globalAlpha = 1;
    }

    // Desk base
    ctx.fillStyle = p.desk[1];
    ctx.fillRect(x - 1, y + T * 2 - 4, T * 2 + 2, 5);
    ctx.fillStyle = p.desk[0];
    ctx.fillRect(x, y + T * 2 - 5, T * 2, 5);

    // Station icon
    this.drawIcon(ctx, x, y, T);

    // Label
    ctx.fillStyle = '#888';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.name, x + T, y + T * 2 + 6);
  }

  private drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, T: number): void {
    const t = this.activeTime;
    const p = this.palette;

    switch (this.icon) {
      case 'terminal': {
        ctx.fillStyle = '#444';
        ctx.fillRect(x + 2, y, T * 2 - 4, T + 8);
        ctx.fillStyle = '#0c0c1c';
        ctx.fillRect(x + 4, y + 2, T * 2 - 8, T + 4);
        const green = this.active ? '#33ff33' : '#116611';
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = green;
          const w = this.active ? (8 + ((t * 30 + i * 7) % 12)) : (6 + i * 2);
          const ox = this.active ? Math.floor(Math.sin(t * 3 + i) * 2) : 0;
          ctx.fillRect(x + 6 + ox, y + 4 + i * 3, Math.min(w, T * 2 - 12), 2);
        }
        ctx.fillStyle = '#555';
        ctx.fillRect(x + T - 2, y + T + 8, 4, 4);
        break;
      }
      case 'cabinet': {
        ctx.fillStyle = '#7b5520';
        ctx.fillRect(x + 4, y, T * 2 - 8, T * 2 - 6);
        ctx.fillStyle = '#a07830';
        for (let i = 0; i < 3; i++) {
          const dy = y + 2 + i * 7;
          const open = this.active && i === 0 ? 4 : 0;
          ctx.fillRect(x + 6 - open, dy, T * 2 - 12, 6);
          ctx.fillStyle = p.gold;
          ctx.fillRect(x + T - 1, dy + 2, 3, 2);
          ctx.fillStyle = '#a07830';
        }
        if (this.active) {
          ctx.fillStyle = '#f0ece0';
          ctx.fillRect(x + 2, y + 1, 6, 8);
          ctx.fillRect(x + 4, y - 2, 4, 6);
        }
        break;
      }
      case 'typewriter': {
        ctx.fillStyle = '#888888';
        ctx.fillRect(x + 3, y + 6, T * 2 - 6, T - 2);
        const paperH = this.active ? (T + Math.floor(t * 4) % 6) : T;
        ctx.fillStyle = '#f0ece0';
        ctx.fillRect(x + 8, y + 6 - Math.min(paperH, T + 4), 14, Math.min(paperH, T + 4));
        if (this.active) {
          ctx.fillStyle = '#333';
          for (let i = 0; i < 3; i++) {
            ctx.fillRect(x + 10, y + 2 - Math.min(paperH, T) + 4 + i * 3, 8 - i, 1);
          }
        }
        ctx.fillStyle = '#555';
        for (let i = 0; i < 5; i++) {
          const kx = x + 5 + i * 4 + (this.active && Math.sin(t * 10 + i * 2) > 0.7 ? -1 : 0);
          ctx.fillRect(kx, y + T, 3, 2);
        }
        ctx.fillStyle = '#666';
        const cx = this.active ? x + 3 + Math.floor(t * 8) % (T * 2 - 8) : x + 3;
        ctx.fillRect(cx, y + 4, 4, 2);
        break;
      }
      case 'drafting': {
        ctx.fillStyle = '#9b8060';
        ctx.beginPath();
        ctx.moveTo(x + 2, y + T + 4);
        ctx.lineTo(x + 6, y + 2);
        ctx.lineTo(x + T * 2 - 4, y + 2);
        ctx.lineTo(x + T * 2 - 2, y + T + 4);
        ctx.fill();
        ctx.fillStyle = '#f0ece0';
        ctx.fillRect(x + 8, y + 3, 14, 12);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = this.active ? (i < Math.floor(t * 2) % 4 ? p.success : p.error) : '#ddd';
          ctx.fillRect(x + 10, y + 5 + i * 3, 10, 1);
        }
        const pencilX = this.active ? x + 10 + Math.sin(t * 5) * 4 : x + T * 2 - 8;
        ctx.fillStyle = '#ffe040';
        ctx.fillRect(pencilX, y + 1, 2, 10);
        ctx.fillStyle = '#333';
        ctx.fillRect(pencilX, y + 10, 2, 2);
        break;
      }
      case 'magnifier': {
        for (let i = 0; i < 3; i++) {
          const glow = this.active && i === Math.floor(t * 2) % 3;
          ctx.fillStyle = glow ? '#88bbff' : '#8b7b5b';
          ctx.fillRect(x + 4 + i * 8, y + 8, 7, 10);
          ctx.fillStyle = glow ? '#aaddff' : '#a09080';
          ctx.fillRect(x + 5 + i * 8, y + 8, 5, 2);
        }
        const mgx = this.active ? x + 8 + Math.sin(t * 3) * 6 : x + 12;
        ctx.strokeStyle = '#8b6b4b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mgx + 4, y + 4, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mgx + 8, y + 8);
        ctx.lineTo(mgx + 12, y + 12);
        ctx.stroke();
        if (this.active) {
          ctx.fillStyle = 'rgba(136,204,255,0.2)';
          ctx.beginPath();
          ctx.arc(mgx + 4, y + 4, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.lineWidth = 1;
        break;
      }
      case 'bookshelf': {
        const bookColors = ['#cc4444', '#4488cc', '#44aa44', '#cc8844', '#8844aa'];
        ctx.fillStyle = '#5b2a10';
        ctx.fillRect(x + 2, y, T * 2 - 4, T * 2 - 6);
        for (let sh = 0; sh < 2; sh++) {
          ctx.fillStyle = '#4a2008';
          ctx.fillRect(x + 2, y + 10 + sh * 10, T * 2 - 4, 2);
          for (let b = 0; b < 5; b++) {
            const slideOut = this.active && sh === 0 && b === Math.floor(t * 1.5) % 5;
            ctx.fillStyle = bookColors[b % bookColors.length];
            ctx.fillRect(x + 4 + b * 5, y + 2 + sh * 10 - (slideOut ? 3 : 0), 4, 8);
          }
        }
        if (this.active) {
          ctx.fillStyle = 'rgba(255,200,100,0.15)';
          ctx.beginPath();
          ctx.moveTo(x + T, y - 2);
          ctx.lineTo(x + 2, y + T * 2 - 8);
          ctx.lineTo(x + T * 2 - 2, y + T * 2 - 8);
          ctx.fill();
        }
        break;
      }
      case 'globe': {
        const gcx = x + T, gcy = y + 8;
        ctx.fillStyle = '#666';
        ctx.fillRect(gcx - 1, gcy + 7, 3, 6);
        ctx.fillRect(gcx - 4, gcy + 12, 9, 2);
        const rot = this.active ? t * 2 : 0;
        ctx.fillStyle = '#3090b0';
        ctx.beginPath();
        ctx.arc(gcx, gcy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#60c8e0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(gcx, gcy, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(gcx, gcy, 3 + Math.sin(rot) * 2, 7, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gcx - 7, gcy);
        ctx.lineTo(gcx + 7, gcy);
        ctx.stroke();
        if (this.active) {
          for (let w = 0; w < 3; w++) {
            const r = 10 + w * 5 + (t * 15) % 8;
            ctx.globalAlpha = Math.max(0, 1 - r / 30);
            ctx.strokeStyle = '#60c8e0';
            ctx.beginPath();
            ctx.arc(gcx, gcy - 4, r, -Math.PI * 0.7, -Math.PI * 0.3);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'dispatch': {
        ctx.fillStyle = p.desk[0];
        ctx.fillRect(x + 2, y + 6, T * 2 - 4, T);
        const ring = this.active && Math.sin(t * 20) > 0.5;
        ctx.fillStyle = '#222';
        ctx.fillRect(x + 6 + (ring ? 1 : 0), y + 8, 8, 4);
        ctx.fillRect(x + 4 + (ring ? -1 : 0), y + 7, 4, 6);
        ctx.fillRect(x + 12 + (ring ? 1 : 0), y + 7, 4, 6);
        ctx.strokeStyle = '#444';
        ctx.beginPath();
        ctx.moveTo(x + 14, y + 12);
        for (let i = 0; i < 4; i++) {
          ctx.lineTo(x + 16 + i * 2, y + 12 + (i % 2 ? 2 : -1));
        }
        ctx.stroke();
        for (let pp = 0; pp < 3; pp++) {
          ctx.fillStyle = pp === 0 ? '#f0ece0' : '#e8e4d8';
          ctx.fillRect(x + T + 4, y + 8 + pp * 2, 8, 5);
        }
        break;
      }
    }
  }
}
