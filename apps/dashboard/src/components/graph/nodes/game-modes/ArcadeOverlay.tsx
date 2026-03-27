// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useEffect, useRef, useCallback, useState, type ReactNode } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
import type { GameScorer, GameScore } from './types';
import {
  computeScore,
  ensurePixelFont,
  spawnBurst,
  updateParticles,
  drawParticles,
  type Particle,
  playChirp,
  playBuzz,
  playCombo,
} from './arcade-utils';

// ── Static keyframes (injected once into <head>) ─────────────
let keyframesInjected = false;
function injectKeyframes() {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes crt-flicker {
      from { opacity: 0.97; }
      to { opacity: 1; }
    }
    @keyframes arcade-shake {
      0%, 100% { transform: translate(0, 0); }
      10% { transform: translate(-2px, 1px); }
      20% { transform: translate(3px, -1px); }
      30% { transform: translate(-1px, 2px); }
      40% { transform: translate(2px, -2px); }
      50% { transform: translate(-3px, 1px); }
      60% { transform: translate(1px, -1px); }
      70% { transform: translate(-2px, 2px); }
      80% { transform: translate(3px, 1px); }
      90% { transform: translate(-1px, -2px); }
    }
    @keyframes combo-bounce {
      0% { transform: scale(1.5); }
      100% { transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

interface Props {
  enabled: boolean;
  soundEnabled: boolean;
  volume: number;
  tools: ToolCallSummary[];
  /** Optional game-mode-specific scorer. Falls back to generic arcade scoring. */
  scorer?: GameScorer;
  /** Hide the score overlay (e.g. when the game component shows its own stats). */
  hideScore?: boolean;
  /** Live score reported by the game component (overrides scorer computation). */
  liveScore?: GameScore | null;
  children: ReactNode;
}

export function ArcadeOverlay({
  enabled,
  soundEnabled,
  volume,
  tools,
  scorer,
  hideScore,
  liveScore,
  children,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const prevCountRef = useRef(tools.length);
  const [shaking, setShaking] = useState(false);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Persistent rAF loop — runs while particles exist, no restart on tool changes
  const rafRef = useRef(0);
  const loopRunningRef = useRef(false);
  const lastTimeRef = useRef(0);
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  // Load pixel font + keyframes on first enable
  useEffect(() => {
    if (enabled) {
      ensurePixelFont();
      injectKeyframes();
    }
  }, [enabled]);

  // Clean up shake timer on unmount
  useEffect(() => {
    return () => {
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    };
  }, []);

  // Score — prefer live score from game component, else use scorer, else generic
  const fallbackScore = scorer ? scorer(tools) : computeScore(tools.map((t) => t.status));
  const { score, combo, comboLabel } = liveScore ?? fallbackScore;

  // Persistent particle animation loop — starts when particles appear, stops when empty
  const startLoop = useCallback(() => {
    if (loopRunningRef.current) return;
    loopRunningRef.current = true;
    lastTimeRef.current = performance.now();

    function loop(now: number) {
      const canvas = canvasRef.current;
      if (!canvas) {
        loopRunningRef.current = false;
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        loopRunningRef.current = false;
        return;
      }

      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = now;

      // Only resize canvas when dimensions actually change [C1 fix]
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (canvasSizeRef.current.w !== w || canvasSizeRef.current.h !== h) {
        canvas.width = w;
        canvas.height = h;
        canvasSizeRef.current = { w, h };
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      particlesRef.current = updateParticles(particlesRef.current, dt);
      drawParticles(ctx, particlesRef.current);

      if (particlesRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        loopRunningRef.current = false;
      }
    }

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // Cancel rAF on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      loopRunningRef.current = false;
    };
  }, []);

  // Spawn particles + play sounds on tool count changes
  const handleNewTools = useCallback(() => {
    if (!enabled) return;
    const prev = prevCountRef.current;
    const curr = tools.length;
    if (curr <= prev) {
      prevCountRef.current = curr;
      return;
    }

    for (let i = prev; i < curr; i++) {
      const tc = tools[i];
      const color = tc.status === 'error' ? '#ef4444' : '#2dd4bf';
      const x = 40 + Math.random() * 100;
      const y = 20 + Math.random() * 40;
      particlesRef.current.push(...spawnBurst(x, y, color, 8));

      if (soundEnabled) {
        if (tc.status === 'error') {
          playBuzz(volume);
          // [C2 fix] Cancel previous shake timer before starting a new one
          if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
          setShaking(true);
          shakeTimerRef.current = setTimeout(() => setShaking(false), 400);
        } else if (combo > 3) {
          playCombo(volume);
        } else {
          playChirp(volume);
        }
      }
    }
    prevCountRef.current = curr;

    // Kick the particle loop if not already running [I6 fix]
    startLoop();
  }, [enabled, tools, soundEnabled, volume, combo, startLoop]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: spawn particles + shake on new tools
  useEffect(() => {
    handleNewTools();
  }, [handleNewTools]);

  if (!enabled) return <>{children}</>;

  return (
    <div
      className="relative"
      style={{
        fontFamily: "'Press Start 2P', monospace",
        fontSize: '8px',
        animation: shaking ? 'arcade-shake 0.4s ease-out' : undefined,
      }}
    >
      {children}

      {/* CRT scanlines overlay */}
      <div
        className="absolute inset-0 pointer-events-none rounded-lg"
        style={{
          zIndex: 100,
          background: `repeating-linear-gradient(
            to bottom,
            transparent 0px, transparent 1px,
            rgba(0, 0, 0, 0.12) 1px, rgba(0, 0, 0, 0.12) 2px
          )`,
          animation: 'crt-flicker 0.05s infinite alternate',
        }}
      />

      {/* Phosphor glow on text */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ textShadow: '0 0 4px currentColor', zIndex: 99 }}
      />

      {/* Particle canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 101 }}
      />

      {/* Score counter */}
      {!hideScore && (
        <div
          className="absolute top-1 right-2 text-yellow-400 z-50 pointer-events-none"
          style={{ fontFamily: "'Press Start 2P', monospace", fontSize: '7px' }}
        >
          <div>{String(score).padStart(6, '0')}</div>
          {combo > 1 && (
            <div
              className="text-red-400 mt-0.5"
              style={{
                animation: 'combo-bounce 0.3s ease-out',
                fontSize: '6px',
              }}
            >
              x{combo} {comboLabel ?? 'COMBO!'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
