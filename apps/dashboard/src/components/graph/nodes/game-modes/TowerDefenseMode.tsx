// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import type { GameModeProps } from './types';

// ── Constants ────────────────────────────────────────────────

const CANVAS_W = 256;
const CANVAS_H = 160;

const TOOL_COLORS: Record<string, string> = {
  Read: '#0d9488', Edit: '#7c3aed', Bash: '#ea580c', Grep: '#2563eb',
  Glob: '#0891b2', Write: '#9333ea', Task: '#059669', WebSearch: '#d97706',
  WebFetch: '#d97706', TodoWrite: '#4f46e5',
};
const DEFAULT_COLOR = '#6b7280';
function getColor(name: string) { return TOOL_COLORS[name] ?? DEFAULT_COLOR; }

const ENEMY_RADIUS = 6;
const ENEMY_SPEED = 0.6;            // pixels per frame
const TURRET_FIRE_INTERVAL = 500;   // ms between turret shots
const LASER_DURATION = 100;         // ms laser line stays visible
const SCORE_DRIFT_DURATION = 800;   // ms "+100" drifts up
const SPARKLE_DURATION = 300;       // ms sparkle at hit position

// ── Path waypoints (S-shaped: right→down→left→down→right) ──

const PATH_WAYPOINTS: { x: number; y: number }[] = [
  { x: 10,  y: 30 },
  { x: 200, y: 30 },
  { x: 200, y: 60 },
  { x: 56,  y: 60 },
  { x: 56,  y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 130 },
  { x: 246, y: 130 },
];

/** Total distance along the path (precomputed). */
function computePathLength(): number {
  let len = 0;
  for (let i = 1; i < PATH_WAYPOINTS.length; i++) {
    const dx = PATH_WAYPOINTS[i].x - PATH_WAYPOINTS[i - 1].x;
    const dy = PATH_WAYPOINTS[i].y - PATH_WAYPOINTS[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

const PATH_LENGTH = computePathLength();

/** Get the (x, y) position at a given distance along the path. */
function positionOnPath(dist: number): { x: number; y: number } {
  let remaining = Math.max(0, Math.min(dist, PATH_LENGTH));
  for (let i = 1; i < PATH_WAYPOINTS.length; i++) {
    const dx = PATH_WAYPOINTS[i].x - PATH_WAYPOINTS[i - 1].x;
    const dy = PATH_WAYPOINTS[i].y - PATH_WAYPOINTS[i - 1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (remaining <= segLen) {
      const t = remaining / segLen;
      return {
        x: PATH_WAYPOINTS[i - 1].x + dx * t,
        y: PATH_WAYPOINTS[i - 1].y + dy * t,
      };
    }
    remaining -= segLen;
  }
  return PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1];
}

// ── Turret positions (beside the path bends) ────────────────

const TURRETS = [
  { x: 128, y: 14 },   // above first horizontal stretch
  { x: 128, y: 118 },  // below third horizontal stretch
];

// ── Animation state types ────────────────────────────────────

interface Enemy {
  toolUseId: string;
  toolName: string;
  color: string;
  status: 'running' | 'success' | 'error';
  dist: number;          // distance along path
  opacity: number;       // for fade-out on kill
  dead: boolean;
  reachedEnd: boolean;
}

interface Laser {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  createdAt: number;
}

interface ScorePopup {
  x: number;
  y: number;
  text: string;
  createdAt: number;
}

interface Sparkle {
  x: number;
  y: number;
  createdAt: number;
}

interface AnimState {
  enemies: Enemy[];
  lasers: Laser[];
  scorePopups: ScorePopup[];
  sparkles: Sparkle[];
  processedCount: number;
  lastFireTime: number;
}

// ── Component ────────────────────────────────────────────────

export function TowerDefenseMode({ tools, selectedNodeId, selectNode }: GameModeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<AnimState>({
    enemies: [],
    lasers: [],
    scorePopups: [],
    sparkles: [],
    processedCount: 0,
    lastFireTime: 0,
  });
  const toolsRef = useRef<ToolCallSummary[]>(tools);
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const [tooltipInfo, setTooltipInfo] = useState<{ text: string; x: number; y: number } | null>(null);
  const [hoveredToolId, setHoveredToolId] = useState<string | null>(null);
  const hoveredToolIdRef = useRef<string | null>(null);

  // Keep refs in sync
  useEffect(() => { toolsRef.current = tools; }, [tools]);
  useEffect(() => { selectedNodeIdRef.current = selectedNodeId; }, [selectedNodeId]);
  useEffect(() => { hoveredToolIdRef.current = hoveredToolId; }, [hoveredToolId]);

  // ── Spawn / update enemies from tool list ────────────────

  useEffect(() => {
    const anim = animRef.current;
    const currentTools = toolsRef.current;

    // Spawn new enemies for tools we haven't processed yet
    while (anim.processedCount < currentTools.length) {
      const tc = currentTools[anim.processedCount];
      // Space enemies along the path entrance based on index
      const startDist = -(anim.processedCount + 1) * 30;
      anim.enemies.push({
        toolUseId: tc.toolUseId,
        toolName: tc.toolName,
        color: getColor(tc.toolName),
        status: tc.status,
        dist: startDist,
        opacity: 1,
        dead: false,
        reachedEnd: false,
      });
      anim.processedCount++;
    }

    // Sync statuses for existing enemies
    for (const enemy of anim.enemies) {
      const tc = currentTools.find((t) => t.toolUseId === enemy.toolUseId);
      if (tc) {
        enemy.status = tc.status;
      }
    }
  }, [tools]);

  // ── Draw path ────────────────────────────────────────────

  const drawPath = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    ctx.moveTo(PATH_WAYPOINTS[0].x, PATH_WAYPOINTS[0].y);
    for (let i = 1; i < PATH_WAYPOINTS.length; i++) {
      ctx.lineTo(PATH_WAYPOINTS[i].x, PATH_WAYPOINTS[i].y);
    }
    ctx.strokeStyle = 'rgba(74, 120, 86, 0.35)';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Inner lighter trail
    ctx.beginPath();
    ctx.moveTo(PATH_WAYPOINTS[0].x, PATH_WAYPOINTS[0].y);
    for (let i = 1; i < PATH_WAYPOINTS.length; i++) {
      ctx.lineTo(PATH_WAYPOINTS[i].x, PATH_WAYPOINTS[i].y);
    }
    ctx.strokeStyle = 'rgba(100, 160, 110, 0.15)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, []);

  // ── Draw turrets (diamond with barrel) ───────────────────

  const drawTurrets = useCallback((ctx: CanvasRenderingContext2D, nearestEnemy: Enemy | null) => {
    for (const turret of TURRETS) {
      // Diamond body
      ctx.save();
      ctx.translate(turret.x, turret.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(-5, -5, 10, 10);
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 1;
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();

      // Barrel: line pointing toward nearest running enemy (or default down-right)
      let barrelAngle = Math.PI / 4;
      if (nearestEnemy && !nearestEnemy.dead) {
        const ePos = positionOnPath(nearestEnemy.dist);
        barrelAngle = Math.atan2(ePos.y - turret.y, ePos.x - turret.x);
      }
      ctx.beginPath();
      ctx.moveTo(turret.x, turret.y);
      ctx.lineTo(turret.x + Math.cos(barrelAngle) * 10, turret.y + Math.sin(barrelAngle) * 10);
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }, []);

  // ── Main render + simulation loop ────────────────────────

  const tick = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(tick); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { rafRef.current = requestAnimationFrame(tick); return; }

    const dt = lastFrameRef.current === 0 ? 16 : timestamp - lastFrameRef.current;
    lastFrameRef.current = timestamp;

    const anim = animRef.current;
    const now = performance.now();
    const hovered = hoveredToolIdRef.current;
    const selected = selectedNodeIdRef.current;

    // ── Update enemies ──────────────────────────────────

    for (const enemy of anim.enemies) {
      if (enemy.dead) continue;

      if (enemy.status === 'running') {
        // Move along path
        enemy.dist += ENEMY_SPEED * (dt / 16);
      } else if (enemy.status === 'success') {
        // Turret handles killing — fade out
        if (enemy.opacity > 0) {
          enemy.opacity -= 0.03 * (dt / 16);
          if (enemy.opacity <= 0) {
            enemy.opacity = 0;
            enemy.dead = true;
          }
        }
      } else if (enemy.status === 'error') {
        // Keep moving to the end of the path
        enemy.dist += ENEMY_SPEED * (dt / 16);
        if (enemy.dist >= PATH_LENGTH) {
          enemy.reachedEnd = true;
          enemy.color = '#ef4444';
        }
      }
    }

    // ── Turret firing logic ─────────────────────────────

    if (now - anim.lastFireTime >= TURRET_FIRE_INTERVAL) {
      // Find nearest running enemy to any turret
      let bestEnemy: Enemy | null = null;
      let bestTurret: typeof TURRETS[0] | null = null;
      let bestDistSq = Infinity;

      for (const turret of TURRETS) {
        for (const enemy of anim.enemies) {
          if (enemy.dead || enemy.status !== 'running' || enemy.dist < 0) continue;
          const ePos = positionOnPath(enemy.dist);
          const dsq = (ePos.x - turret.x) ** 2 + (ePos.y - turret.y) ** 2;
          if (dsq < bestDistSq) {
            bestDistSq = dsq;
            bestEnemy = enemy;
            bestTurret = turret;
          }
        }
      }

      if (bestEnemy && bestTurret) {
        const ePos = positionOnPath(bestEnemy.dist);
        anim.lasers.push({
          fromX: bestTurret.x,
          fromY: bestTurret.y,
          toX: ePos.x,
          toY: ePos.y,
          createdAt: now,
        });
        anim.lastFireTime = now;
      }
    }

    // ── Clean up expired effects ────────────────────────

    anim.lasers = anim.lasers.filter((l) => now - l.createdAt < LASER_DURATION);
    anim.scorePopups = anim.scorePopups.filter((p) => now - p.createdAt < SCORE_DRIFT_DURATION);
    anim.sparkles = anim.sparkles.filter((s) => now - s.createdAt < SPARKLE_DURATION);

    // ── Handle success kills: spawn effects for freshly-killed enemies ──

    for (const enemy of anim.enemies) {
      if (enemy.status === 'success' && enemy.opacity === 1 && !enemy.dead) {
        // This enemy just became success — start fade and spawn effects
        const ePos = positionOnPath(Math.max(0, enemy.dist));
        anim.scorePopups.push({ x: ePos.x, y: ePos.y - 8, text: '+100', createdAt: now });
        anim.sparkles.push({ x: ePos.x, y: ePos.y, createdAt: now });
        enemy.opacity = 0.99; // mark as processing (no longer 1)
      }
    }

    // ── Find nearest running enemy for turret barrel aim ─

    let nearestRunning: Enemy | null = null;
    let nearestRunDist = Infinity;
    for (const enemy of anim.enemies) {
      if (enemy.dead || enemy.status !== 'running' || enemy.dist < 0) continue;
      const ePos = positionOnPath(enemy.dist);
      const avg = (TURRETS[0].x + TURRETS[1].x) / 2;
      const d = Math.abs(ePos.x - avg);
      if (d < nearestRunDist) {
        nearestRunDist = d;
        nearestRunning = enemy;
      }
    }

    // ── Clear & draw ────────────────────────────────────

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Background subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.015)';
    ctx.lineWidth = 0.5;
    for (let y = 0; y < CANVAS_H; y += 16) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }
    for (let x = 0; x < CANVAS_W; x += 16) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }

    drawPath(ctx);
    drawTurrets(ctx, nearestRunning);

    // ── Draw enemies ────────────────────────────────────

    for (const enemy of anim.enemies) {
      if (enemy.dead && !enemy.reachedEnd) continue;
      if (enemy.dist < -ENEMY_RADIUS) continue; // not on screen yet

      const pos = positionOnPath(Math.max(0, enemy.dist));
      const isHovered = hovered === enemy.toolUseId;
      const isSelected = selected === `tool-${enemy.toolUseId}`;

      ctx.save();

      // Enemy circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, ENEMY_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = enemy.reachedEnd ? '#ef4444' : enemy.color;
      ctx.globalAlpha = enemy.reachedEnd ? 0.9 : Math.max(0, enemy.opacity);

      if (enemy.status === 'running') {
        // Pulsing glow for running enemies
        const pulse = 0.65 + 0.2 * Math.sin(timestamp * 0.005);
        ctx.globalAlpha = pulse;
      }

      ctx.fill();

      // Hover highlight
      if (isHovered) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.9;
        ctx.stroke();
      }

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ENEMY_RADIUS + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Error indicator: red "!" above the enemy at path end
      if (enemy.reachedEnd) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('!', pos.x, pos.y - ENEMY_RADIUS - 3);
      }

      ctx.restore();
    }

    // ── Draw lasers ─────────────────────────────────────

    for (const laser of anim.lasers) {
      const age = now - laser.createdAt;
      const alpha = Math.max(0, 1 - age / LASER_DURATION);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(laser.fromX, laser.fromY);
      ctx.lineTo(laser.toX, laser.toY);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha * 0.8;
      ctx.stroke();
      ctx.restore();
    }

    // ── Draw score popups ───────────────────────────────

    for (const popup of anim.scorePopups) {
      const age = now - popup.createdAt;
      const t = age / SCORE_DRIFT_DURATION;
      const alpha = Math.max(0, 1 - t);
      const y = popup.y - t * 16;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(popup.text, popup.x, y);
      ctx.restore();
    }

    // ── Draw sparkles ───────────────────────────────────

    for (const sparkle of anim.sparkles) {
      const age = now - sparkle.createdAt;
      const t = age / SPARKLE_DURATION;
      const alpha = Math.max(0, 1 - t);
      const size = 3 + t * 6;
      ctx.save();
      ctx.globalAlpha = alpha * 0.7;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1;

      // Draw a 4-point star
      const arms = 4;
      for (let i = 0; i < arms; i++) {
        const angle = (Math.PI * 2 * i) / arms + t * Math.PI;
        ctx.beginPath();
        ctx.moveTo(sparkle.x, sparkle.y);
        ctx.lineTo(sparkle.x + Math.cos(angle) * size, sparkle.y + Math.sin(angle) * size);
        ctx.stroke();
      }

      ctx.restore();
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [drawPath, drawTurrets]);

  // ── Start / stop animation loop ──────────────────────

  useEffect(() => {
    lastFrameRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  // ── Mouse interaction ────────────────────────────────

  const hitTest = useCallback((clientX: number, clientY: number): Enemy | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    const anim = animRef.current;
    for (const enemy of anim.enemies) {
      if (enemy.dead && !enemy.reachedEnd) continue;
      if (enemy.dist < -ENEMY_RADIUS) continue;
      const pos = positionOnPath(Math.max(0, enemy.dist));
      const dx = pos.x - mx;
      const dy = pos.y - my;
      if (dx * dx + dy * dy <= (ENEMY_RADIUS + 4) ** 2) {
        return enemy;
      }
    }
    return null;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    const enemy = hitTest(e.clientX, e.clientY);
    if (enemy) {
      selectNode(`tool-${enemy.toolUseId}`, 'graph');
    }
  }, [selectNode, hitTest]);

  const handleMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const enemy = hitTest(e.clientX, e.clientY);
    if (enemy) {
      setHoveredToolId(enemy.toolUseId);
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        setTooltipInfo({
          text: `${enemy.toolName} \u00b7 ${enemy.status}`,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
      return;
    }
    setHoveredToolId(null);
    setTooltipInfo(null);
  }, [hitTest]);

  const handleLeave = useCallback(() => {
    setHoveredToolId(null);
    setTooltipInfo(null);
  }, []);

  // ── Legend ────────────────────────────────────────────

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

  return (
    <div className="relative" style={{ width: CANVAS_W }}>
      <div style={{ width: CANVAS_W, height: CANVAS_H, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="cursor-pointer"
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
              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color, opacity: 0.85 }} />
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
