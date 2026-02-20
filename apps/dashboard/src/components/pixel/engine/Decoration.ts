import type { DecorationDef, Palette } from './types';
import { TILE } from './types';
import type { ParticleManager } from './ParticleManager';

export function drawDecoration(
  ctx: CanvasRenderingContext2D,
  d: DecorationDef,
  palette: Palette,
  time: number,
  particles?: ParticleManager,
  costUsd?: number,
): void {
  const x = d.col * TILE, y = d.row * TILE;
  const T = TILE;

  switch (d.type) {
    case 'plant': {
      ctx.fillStyle = '#8b5e2a';
      ctx.fillRect(x + 4, y + 10, 8, 6);
      ctx.fillStyle = '#2d8b37';
      const sway = Math.sin(time * 1.5 + d.col) * 1;
      ctx.fillRect(x + 3 + sway, y + 2, 4, 9);
      ctx.fillRect(x + 8 - sway, y + 4, 4, 7);
      ctx.fillRect(x + 5, y, 5, 5);
      ctx.fillStyle = '#1a6625';
      ctx.fillRect(x + 6 + sway, y + 1, 3, 4);
      break;
    }
    case 'coffee': {
      ctx.fillStyle = '#4a2a10';
      ctx.fillRect(x + 2, y + 4, 12, 12);
      ctx.fillStyle = '#3a1a08';
      ctx.fillRect(x + 4, y + 6, 8, 4);
      ctx.fillStyle = '#888';
      ctx.fillRect(x + 6, y + 2, 4, 3);
      if (particles && Math.random() < 0.05) {
        particles.emit('steam', x + 8, y + 2, 1);
      }
      break;
    }
    case 'clock': {
      const cx = x + 8, cy = y + 8;
      ctx.fillStyle = '#f0ece0';
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.stroke();
      const sec = time % 60;
      const min = (time / 10) % 60;
      ctx.strokeStyle = '#333';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(min / 60 * Math.PI * 2) * 4, cy - Math.cos(min / 60 * Math.PI * 2) * 4);
      ctx.stroke();
      ctx.strokeStyle = palette.error;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(sec / 60 * Math.PI * 2) * 5, cy - Math.cos(sec / 60 * Math.PI * 2) * 5);
      ctx.stroke();
      break;
    }
    case 'board': {
      ctx.fillStyle = '#6b4420';
      ctx.fillRect(x, y, T * 2, T * 2);
      ctx.fillStyle = '#5a3818';
      ctx.fillRect(x + 2, y + 2, T * 2 - 4, T * 2 - 4);
      const notes = [
        { nx: x + 4, ny: y + 4, w: 10, h: 8, color: '#f5f0d0' },
        { nx: x + 16, ny: y + 3, w: 9, h: 7, color: '#e8e4d0' },
        { nx: x + 6, ny: y + 14, w: 11, h: 9, color: '#f0e8d0' },
        { nx: x + 18, ny: y + 13, w: 8, h: 8, color: '#f5f0d0' },
      ];
      for (const n of notes) {
        ctx.fillStyle = n.color;
        ctx.fillRect(n.nx, n.ny, n.w, n.h);
        ctx.fillStyle = '#aaa';
        for (let l = 0; l < 2; l++) ctx.fillRect(n.nx + 1, n.ny + 2 + l * 3, n.w - 3, 1);
        ctx.fillStyle = '#cc3333';
        ctx.fillRect(n.nx + n.w / 2 - 1, n.ny - 1, 2, 2);
      }
      ctx.fillStyle = '#888';
      ctx.font = '5px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Tasks', x + T, y + T * 2 + 6);
      break;
    }
    case 'cooler': {
      ctx.fillStyle = '#b8c8d8';
      ctx.fillRect(x + 4, y + 4, 8, 10);
      ctx.fillStyle = '#88b8e8';
      ctx.fillRect(x + 5, y + 5, 6, 5);
      ctx.fillStyle = '#666';
      ctx.fillRect(x + 5, y + 14, 2, 2);
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(x + 3, y + 2, 10, 3);
      break;
    }
    case 'output': {
      ctx.fillStyle = '#444';
      ctx.fillRect(x + 2, y + 4, T * 2 - 4, T * 2 - 6);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(x + 4, y + 6, T * 2 - 8, T - 4);
      ctx.fillStyle = '#336633';
      ctx.fillRect(x + 6, y + 8, 8, 2);
      ctx.fillStyle = palette.gold;
      ctx.fillRect(x + 6, y + 12, 12, 2);
      ctx.fillRect(x + 6, y + 16, 6, 2);
      ctx.fillStyle = palette.gold;
      ctx.font = '5px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Output', x + T, y + T * 2 + 2);
      break;
    }
    case 'costmeter': {
      const cost = costUsd ?? 0;
      ctx.fillStyle = '#333';
      ctx.fillRect(x, y, T * 2, T + 6);
      ctx.fillStyle = '#222';
      ctx.fillRect(x + 2, y + 2, T * 2 - 4, T + 2);
      const fill = Math.min(1, cost / 2.0);
      const barColor = fill > 0.8 ? palette.error : fill > 0.5 ? palette.gold : palette.success;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(x + 4, y + T - 2, T * 2 - 8, 4);
      ctx.fillStyle = barColor;
      ctx.fillRect(x + 4, y + T - 2, Math.floor((T * 2 - 8) * fill), 4);
      ctx.fillStyle = barColor;
      ctx.font = '6px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('$' + cost.toFixed(2), x + T, y + 8);
      ctx.fillStyle = '#666';
      ctx.font = '5px monospace';
      ctx.fillText('Cost', x + T, y + T + 10);
      break;
    }
  }
}
