// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { formatDuration } from '@synapse-ai/core';
import type { GameModeProps } from './types';
import { spawnBurst, updateParticles, drawParticles, type Particle } from './arcade-utils';

// ── Constants ────────────────────────────────────────────────

const CANVAS_W = 256;
const CANVAS_H = 180;

const BRICK_W = 30;
const BRICK_H = 12;
const BRICK_GAP = 2;
const BRICKS_PER_ROW = 8;
const BRICK_AREA_LEFT = Math.floor(
  (CANVAS_W - BRICKS_PER_ROW * (BRICK_W + BRICK_GAP) + BRICK_GAP) / 2,
);
const BRICK_TOP = 10;

const PADDLE_W = 40;
const PADDLE_H = 6;
const PADDLE_Y = CANVAS_H - 16;
const PADDLE_TRACK_SPEED = 0.08; // how quickly paddle follows ball (0–1, lower = more lag)

const BALL_RADIUS = 2;
const BALL_SPEED = 2; // px per frame at 60fps
const MAX_BOUNCE_ANGLE = Math.PI / 3; // 60 degrees max off vertical

const TOOL_COLORS: Record<string, string> = {
  Read: '#0d9488',
  Edit: '#7c3aed',
  Bash: '#ea580c',
  Grep: '#2563eb',
  Glob: '#0891b2',
  Write: '#9333ea',
  Task: '#059669',
  WebSearch: '#d97706',
  WebFetch: '#d97706',
  TodoWrite: '#4f46e5',
};
const DEFAULT_COLOR = '#6b7280';
function getColor(name: string) {
  return TOOL_COLORS[name] ?? DEFAULT_COLOR;
}

// ── Brick data ───────────────────────────────────────────────

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  toolUseId: string;
  toolName: string;
  status: 'running' | 'success' | 'error';
  alive: boolean; // false = shattered
}

// ── Ball state ───────────────────────────────────────────────

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function initialBall(): Ball {
  const angle = -Math.PI / 4 + (Math.random() * Math.PI) / 2; // -45 to +45 degrees from vertical
  return {
    x: CANVAS_W / 2,
    y: CANVAS_H / 2,
    vx: Math.sin(angle) * BALL_SPEED,
    vy: -Math.cos(angle) * BALL_SPEED,
  };
}

// ── Component ────────────────────────────────────────────────

export function BreakoutMode({ tools, selectedNodeId, selectNode }: GameModeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bricksRef = useRef<Brick[]>([]);
  const ballRef = useRef<Ball>(initialBall());
  const paddleXRef = useRef(CANVAS_W / 2 - PADDLE_W / 2);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);
  const knownToolsRef = useRef(new Set<string>());
  const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);
  const hoveredToolIdRef = useRef<string | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const [tooltipInfo, setTooltipInfo] = useState<{ text: string; x: number; y: number } | null>(
    null,
  );

  // Keep refs in sync
  useEffect(() => {
    hoveredToolIdRef.current = hoveredToolId;
  }, [hoveredToolId]);
  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  // ── Sync tools → bricks ──────────────────────────────────
  useEffect(() => {
    const bricks = bricksRef.current;

    // Update existing brick statuses
    for (const brick of bricks) {
      const tc = tools.find((t) => t.toolUseId === brick.toolUseId);
      if (tc) brick.status = tc.status;
    }

    // Add new tools as bricks
    for (const tc of tools) {
      if (knownToolsRef.current.has(tc.toolUseId)) continue;
      knownToolsRef.current.add(tc.toolUseId);

      const idx = bricks.length;
      const row = Math.floor(idx / BRICKS_PER_ROW);
      const col = idx % BRICKS_PER_ROW;

      bricks.push({
        x: BRICK_AREA_LEFT + col * (BRICK_W + BRICK_GAP),
        y: BRICK_TOP + row * (BRICK_H + BRICK_GAP),
        w: BRICK_W,
        h: BRICK_H,
        color: getColor(tc.toolName),
        toolUseId: tc.toolUseId,
        toolName: tc.toolName,
        status: tc.status,
        alive: true,
      });
    }
  }, [tools]);

  // ── Draw helpers ──────────────────────────────────────────

  const drawBrick = useCallback(
    (ctx: CanvasRenderingContext2D, brick: Brick, isHovered: boolean, isSelected: boolean) => {
      const { x, y, w, h, color, status } = brick;

      ctx.save();

      if (!brick.alive) {
        // Ghost brick: faint dotted outline so tool history remains visible
        ctx.globalAlpha = isHovered ? 0.35 : 0.15;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        roundRect(ctx, x, y, w, h, 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Faint label
        ctx.globalAlpha = isHovered ? 0.5 : 0.2;
        ctx.fillStyle = color;
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(brick.toolName.slice(0, 4), x + w / 2, y + h / 2);

        // Selection ring for ghost bricks
        if (isSelected) {
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          roundRect(ctx, x - 1, y - 1, w + 2, h + 2, 3);
          ctx.stroke();
        }

        ctx.restore();
        return;
      }

      if (status === 'running') {
        // Shielded: semi-transparent with pulsing glow
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = color;
        roundRect(ctx, x, y, w, h, 2);
        ctx.fill();
        // Shield shimmer
        ctx.globalAlpha = 0.15 + 0.1 * Math.sin(Date.now() / 300);
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, x, y, w, h, 2);
        ctx.fill();
      } else if (status === 'error') {
        // Red with crack pattern
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#ef4444';
        roundRect(ctx, x, y, w, h, 2);
        ctx.fill();
        // Crack lines
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.3, y);
        ctx.lineTo(x + w * 0.5, y + h * 0.5);
        ctx.lineTo(x + w * 0.35, y + h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + w * 0.5, y + h * 0.5);
        ctx.lineTo(x + w * 0.75, y + h * 0.3);
        ctx.stroke();
      } else {
        // Success: breakable, solid
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = color;
        roundRect(ctx, x, y, w, h, 2);
        ctx.fill();
      }

      // Hover highlight
      if (isHovered) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, x, y, w, h, 2);
        ctx.fill();
      }

      // Selection ring
      if (isSelected) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1.5;
        roundRect(ctx, x - 1, y - 1, w + 2, h + 2, 3);
        ctx.stroke();
      }

      // Tool name label
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(brick.toolName.slice(0, 4), x + w / 2, y + h / 2);

      ctx.restore();
    },
    [],
  );

  // ── Main animation loop ───────────────────────────────────

  const tick = useCallback(
    (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 16.667, 3) : 1; // normalize to 60fps
      lastTimeRef.current = time;

      const ball = ballRef.current;
      const bricks = bricksRef.current;
      const hovered = hoveredToolIdRef.current;
      const selected = selectedNodeIdRef.current;

      // ── Update ball position ──
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // ── Wall collisions ──
      if (ball.x - BALL_RADIUS <= 0) {
        ball.x = BALL_RADIUS;
        ball.vx = Math.abs(ball.vx);
        addAngleVariation(ball);
      }
      if (ball.x + BALL_RADIUS >= CANVAS_W) {
        ball.x = CANVAS_W - BALL_RADIUS;
        ball.vx = -Math.abs(ball.vx);
        addAngleVariation(ball);
      }
      if (ball.y - BALL_RADIUS <= 0) {
        ball.y = BALL_RADIUS;
        ball.vy = Math.abs(ball.vy);
        addAngleVariation(ball);
      }
      // Bottom wall: reset ball instead of losing life
      if (ball.y + BALL_RADIUS >= CANVAS_H) {
        ball.y = CANVAS_H - BALL_RADIUS;
        ball.vy = -Math.abs(ball.vy);
        addAngleVariation(ball);
      }

      // ── Paddle movement (autonomous, tracks ball) ──
      const paddleTarget = Math.max(0, Math.min(CANVAS_W - PADDLE_W, ball.x - PADDLE_W / 2));
      paddleXRef.current += (paddleTarget - paddleXRef.current) * PADDLE_TRACK_SPEED * dt;

      // ── Paddle collision ──
      const px = paddleXRef.current;
      if (
        ball.vy > 0 &&
        ball.y + BALL_RADIUS >= PADDLE_Y &&
        ball.y + BALL_RADIUS <= PADDLE_Y + PADDLE_H + 2 &&
        ball.x >= px &&
        ball.x <= px + PADDLE_W
      ) {
        ball.y = PADDLE_Y - BALL_RADIUS;
        // Reflect angle based on where ball hits paddle
        const hitPos = (ball.x - px) / PADDLE_W; // 0..1
        const angle = (hitPos - 0.5) * MAX_BOUNCE_ANGLE * 2; // spread across max angle
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        ball.vx = Math.sin(angle) * speed;
        ball.vy = -Math.cos(angle) * speed;
        ensureMinSpeed(ball);
      }

      // ── Brick collisions ──
      for (const brick of bricks) {
        if (!brick.alive) continue;

        // Check AABB collision between ball and brick
        const closestX = Math.max(brick.x, Math.min(ball.x, brick.x + brick.w));
        const closestY = Math.max(brick.y, Math.min(ball.y, brick.y + brick.h));
        const dx = ball.x - closestX;
        const dy = ball.y - closestY;

        if (dx * dx + dy * dy <= BALL_RADIUS * BALL_RADIUS) {
          // Determine reflection direction
          const overlapLeft = ball.x - brick.x;
          const overlapRight = brick.x + brick.w - ball.x;
          const overlapTop = ball.y - brick.y;
          const overlapBottom = brick.y + brick.h - ball.y;
          const minOverlapX = Math.min(overlapLeft, overlapRight);
          const minOverlapY = Math.min(overlapTop, overlapBottom);

          if (minOverlapX < minOverlapY) {
            ball.vx = -ball.vx;
          } else {
            ball.vy = -ball.vy;
          }
          addAngleVariation(ball);

          // Breakable only if success status
          if (brick.status === 'success') {
            brick.alive = false;
            // Spawn burst particles
            particlesRef.current.push(
              ...spawnBurst(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.color, 10),
            );
          }
          // running and error bricks: ball bounces but brick stays

          break; // only one brick collision per frame
        }
      }

      // ── Update particles ──
      particlesRef.current = updateParticles(particlesRef.current, dt / 60);

      // ── Draw ──
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      // Background
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Bricks
      for (const brick of bricks) {
        const isH = hovered === brick.toolUseId;
        const isS = selected === `tool-${brick.toolUseId}`;
        drawBrick(ctx, brick, isH, isS);
      }

      // Paddle
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.9;
      roundRect(ctx, paddleXRef.current, PADDLE_Y, PADDLE_W, PADDLE_H, 3);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Ball
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      // Ball trail (subtle)
      ctx.globalAlpha = 0.15;
      ctx.beginPath();
      ctx.arc(ball.x - ball.vx * 1.5, ball.y - ball.vy * 1.5, BALL_RADIUS * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.07;
      ctx.beginPath();
      ctx.arc(ball.x - ball.vx * 3, ball.y - ball.vy * 3, BALL_RADIUS * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Particles
      drawParticles(ctx, particlesRef.current);

      rafRef.current = requestAnimationFrame(tick);
    },
    [drawBrick],
  );

  // Start/stop animation
  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  // ── Mouse interaction ─────────────────────────────────────

  const findBrickAt = useCallback((clientX: number, clientY: number): Brick | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = (clientX - rect.left) * (CANVAS_W / rect.width);
    const my = (clientY - rect.top) * (CANVAS_H / rect.height);

    // Check alive bricks first (on top), then ghost bricks
    for (const brick of bricksRef.current) {
      if (!brick.alive) continue;
      if (mx >= brick.x && mx <= brick.x + brick.w && my >= brick.y && my <= brick.y + brick.h) {
        return brick;
      }
    }
    for (const brick of bricksRef.current) {
      if (brick.alive) continue;
      if (mx >= brick.x && mx <= brick.x + brick.w && my >= brick.y && my <= brick.y + brick.h) {
        return brick;
      }
    }
    return null;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.stopPropagation();
      const brick = findBrickAt(e.clientX, e.clientY);
      if (brick) {
        selectNode(`tool-${brick.toolUseId}`, 'graph');
      }
    },
    [findBrickAt, selectNode],
  );

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const brick = findBrickAt(e.clientX, e.clientY);
      if (brick) {
        setHoveredToolId(brick.toolUseId);
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const tc = tools.find((t) => t.toolUseId === brick.toolUseId);
          const dur = tc?.duration != null ? ` \u00b7 ${formatDuration(tc.duration)}` : '';
          setTooltipInfo({
            text: `${brick.toolName} \u00b7 ${brick.status}${dur}`,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
        }
      } else {
        setHoveredToolId(null);
        setTooltipInfo(null);
      }
    },
    [findBrickAt, tools],
  );

  const handleLeave = useCallback(() => {
    setHoveredToolId(null);
    setTooltipInfo(null);
  }, []);

  // ── Legend ─────────────────────────────────────────────────

  const legend = useMemo(() => {
    const seen = new Set<string>();
    const items: { name: string; color: string }[] = [];
    for (const t of tools) {
      if (seen.has(t.toolName)) continue;
      seen.add(t.toolName);
      items.push({ name: t.toolName, color: getColor(t.toolName) });
    }
    return items;
  }, [tools]);

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="relative" style={{ width: CANVAS_W }}>
      <div style={{ width: CANVAS_W, height: CANVAS_H, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="cursor-pointer rounded"
          onClick={handleClick}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
        />
        {tooltipInfo && (
          <div
            className="absolute pointer-events-none bg-gray-900/90 text-gray-200 text-[9px] px-1.5 py-0.5 rounded border border-gray-700 whitespace-nowrap z-20"
            style={{ left: tooltipInfo.x + 8, top: tooltipInfo.y - 20 }}
          >
            {tooltipInfo.text}
          </div>
        )}
      </div>
      {legend.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 px-0.5">
          {legend.map(({ name, color }) => (
            <span key={name} className="flex items-center gap-1 text-[8px] text-gray-400">
              <span
                className="w-2 h-2 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color, opacity: 0.85 }}
              />
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Utility functions ──────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Add slight random angle variation on bounce to keep trajectories interesting. */
function addAngleVariation(ball: Ball) {
  const angle = Math.atan2(ball.vy, ball.vx);
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  const jitter = (Math.random() - 0.5) * 0.15; // ~8.5 degrees max
  const newAngle = angle + jitter;
  ball.vx = Math.cos(newAngle) * speed;
  ball.vy = Math.sin(newAngle) * speed;
  ensureMinSpeed(ball);
}

/** Prevent ball from going too horizontal or too slow. */
function ensureMinSpeed(ball: Ball) {
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  // Clamp speed to BALL_SPEED
  if (speed < BALL_SPEED * 0.5 || speed > BALL_SPEED * 1.5) {
    const factor = BALL_SPEED / speed;
    ball.vx *= factor;
    ball.vy *= factor;
  }
  // Ensure minimum vertical component so ball doesn't go perfectly horizontal
  if (Math.abs(ball.vy) < 0.4) {
    ball.vy = ball.vy >= 0 ? 0.4 : -0.4;
  }
}
