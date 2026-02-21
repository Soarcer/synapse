// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

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
  const S = T / 16;

  switch (d.type) {
    case 'plant': {
      ctx.fillStyle = '#8b5e2a';
      ctx.fillRect(x + 4 * S, y + 10 * S, 8 * S, 6 * S);
      ctx.fillStyle = '#2d8b37';
      const sway = Math.sin(time * 1.5 + d.col) * S;
      ctx.fillRect(x + 3 * S + sway, y + 2 * S, 4 * S, 9 * S);
      ctx.fillRect(x + 8 * S - sway, y + 4 * S, 4 * S, 7 * S);
      ctx.fillRect(x + 5 * S, y, 5 * S, 5 * S);
      ctx.fillStyle = '#1a6625';
      ctx.fillRect(x + 6 * S + sway, y + S, 3 * S, 4 * S);
      break;
    }
    case 'coffee': {
      ctx.fillStyle = '#4a2a10';
      ctx.fillRect(x + 2 * S, y + 4 * S, 12 * S, 12 * S);
      ctx.fillStyle = '#3a1a08';
      ctx.fillRect(x + 4 * S, y + 6 * S, 8 * S, 4 * S);
      ctx.fillStyle = '#888';
      ctx.fillRect(x + 6 * S, y + 2 * S, 4 * S, 3 * S);
      if (particles && Math.random() < 0.05) {
        particles.emit('steam', x + 8 * S, y + 2 * S, 1);
      }
      break;
    }
    case 'clock': {
      const cx = x + 8 * S, cy = y + 8 * S;
      ctx.fillStyle = '#f0ece0';
      ctx.beginPath();
      ctx.arc(cx, cy, 6 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#555';
      ctx.lineWidth = S;
      ctx.beginPath();
      ctx.arc(cx, cy, 6 * S, 0, Math.PI * 2);
      ctx.stroke();
      const sec = time % 60;
      const min = (time / 10) % 60;
      ctx.strokeStyle = '#333';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(min / 60 * Math.PI * 2) * 4 * S, cy - Math.cos(min / 60 * Math.PI * 2) * 4 * S);
      ctx.stroke();
      ctx.strokeStyle = palette.error;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(sec / 60 * Math.PI * 2) * 5 * S, cy - Math.cos(sec / 60 * Math.PI * 2) * 5 * S);
      ctx.stroke();
      break;
    }
    case 'board': {
      ctx.fillStyle = '#6b4420';
      ctx.fillRect(x, y, T * 2, T * 2);
      ctx.fillStyle = '#5a3818';
      ctx.fillRect(x + 2 * S, y + 2 * S, T * 2 - 4 * S, T * 2 - 4 * S);
      const notes = [
        { nx: x + 4 * S, ny: y + 4 * S, w: 10 * S, h: 8 * S, color: '#f5f0d0' },
        { nx: x + 16 * S, ny: y + 3 * S, w: 9 * S, h: 7 * S, color: '#e8e4d0' },
        { nx: x + 6 * S, ny: y + 14 * S, w: 11 * S, h: 9 * S, color: '#f0e8d0' },
        { nx: x + 18 * S, ny: y + 13 * S, w: 8 * S, h: 8 * S, color: '#f5f0d0' },
      ];
      for (const n of notes) {
        ctx.fillStyle = n.color;
        ctx.fillRect(n.nx, n.ny, n.w, n.h);
        ctx.fillStyle = '#aaa';
        for (let l = 0; l < 2; l++) ctx.fillRect(n.nx + S, n.ny + 2 * S + l * 3 * S, n.w - 3 * S, S);
        ctx.fillStyle = '#cc3333';
        ctx.fillRect(n.nx + n.w / 2 - S, n.ny - S, 2 * S, 2 * S);
      }
      ctx.fillStyle = '#888';
      ctx.font = `${5 * S}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('Tasks', x + T, y + T * 2 + 6 * S);
      break;
    }
    case 'cooler': {
      ctx.fillStyle = '#b8c8d8';
      ctx.fillRect(x + 4 * S, y + 4 * S, 8 * S, 10 * S);
      ctx.fillStyle = '#88b8e8';
      ctx.fillRect(x + 5 * S, y + 5 * S, 6 * S, 5 * S);
      ctx.fillStyle = '#666';
      ctx.fillRect(x + 5 * S, y + 14 * S, 2 * S, 2 * S);
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(x + 3 * S, y + 2 * S, 10 * S, 3 * S);
      break;
    }
    case 'output': {
      ctx.fillStyle = '#444';
      ctx.fillRect(x + 2 * S, y + 4 * S, T * 2 - 4 * S, T * 2 - 6 * S);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(x + 4 * S, y + 6 * S, T * 2 - 8 * S, T - 4 * S);
      ctx.fillStyle = '#336633';
      ctx.fillRect(x + 6 * S, y + 8 * S, 8 * S, 2 * S);
      ctx.fillStyle = palette.gold;
      ctx.fillRect(x + 6 * S, y + 12 * S, 12 * S, 2 * S);
      ctx.fillRect(x + 6 * S, y + 16 * S, 6 * S, 2 * S);
      ctx.fillStyle = palette.gold;
      ctx.font = `${5 * S}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('Output', x + T, y + T * 2 + 2 * S);
      break;
    }
    case 'costmeter': {
      const cost = costUsd ?? 0;
      ctx.fillStyle = '#333';
      ctx.fillRect(x, y, T * 2, T + 6 * S);
      ctx.fillStyle = '#222';
      ctx.fillRect(x + 2 * S, y + 2 * S, T * 2 - 4 * S, T + 2 * S);
      const fill = Math.min(1, cost / 2.0);
      const barColor = fill > 0.8 ? palette.error : fill > 0.5 ? palette.gold : palette.success;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(x + 4 * S, y + T - 2 * S, T * 2 - 8 * S, 4 * S);
      ctx.fillStyle = barColor;
      ctx.fillRect(x + 4 * S, y + T - 2 * S, Math.floor((T * 2 - 8 * S) * fill), 4 * S);
      ctx.fillStyle = barColor;
      ctx.font = `${6 * S}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('$' + cost.toFixed(2), x + T, y + 8 * S);
      ctx.fillStyle = '#666';
      ctx.font = `${5 * S}px monospace`;
      ctx.fillText('Cost', x + T, y + T + 10 * S);
      break;
    }
  }
}
