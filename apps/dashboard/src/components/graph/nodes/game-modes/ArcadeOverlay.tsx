// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useRef, useMemo, useCallback, useState, type ReactNode } from 'react';
import type { ToolCallSummary } from '@synapse-ai/core';
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

interface Props {
  enabled: boolean;
  soundEnabled: boolean;
  volume: number;
  tools: ToolCallSummary[];
  children: ReactNode;
}

export function ArcadeOverlay({ enabled, soundEnabled, volume, tools, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const prevCountRef = useRef(tools.length);
  const [shaking, setShaking] = useState(false);

  // Load pixel font on first enable
  useEffect(() => { if (enabled) ensurePixelFont(); }, [enabled]);

  // Score
  const { score, combo } = useMemo(
    () => computeScore(tools.map((t) => t.status)),
    [tools],
  );

  // Spawn particles + play sounds on tool count changes
  const handleNewTools = useCallback(() => {
    if (!enabled) return;
    const prev = prevCountRef.current;
    const curr = tools.length;
    if (curr <= prev) { prevCountRef.current = curr; return; }

    for (let i = prev; i < curr; i++) {
      const tc = tools[i];
      const color = tc.status === 'error' ? '#ef4444' : '#2dd4bf';
      // Spawn particles at a random position within the container
      const x = 40 + Math.random() * 100;
      const y = 20 + Math.random() * 40;
      particlesRef.current.push(...spawnBurst(x, y, color, 8));

      if (soundEnabled) {
        if (tc.status === 'error') {
          playBuzz(volume);
          setShaking(true);
          setTimeout(() => setShaking(false), 400);
        } else if (combo > 3) {
          playCombo(volume);
        } else {
          playChirp(volume);
        }
      }
    }
    prevCountRef.current = curr;
  }, [enabled, tools, soundEnabled, volume, combo]);

  useEffect(() => { handleNewTools(); }, [handleNewTools]);

  // Particle animation loop
  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    let lastTime = performance.now();

    function loop(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      canvas!.width = canvas!.offsetWidth;
      canvas!.height = canvas!.offsetHeight;
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      particlesRef.current = updateParticles(particlesRef.current, dt);
      drawParticles(ctx!, particlesRef.current);

      if (particlesRef.current.length > 0) {
        raf = requestAnimationFrame(loop);
      }
    }

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, tools.length]); // restart loop when new tools arrive

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
      <div className="absolute inset-0 pointer-events-none" style={{ textShadow: '0 0 4px currentColor', zIndex: 99 }} />

      {/* Particle canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 101 }}
      />

      {/* Score counter */}
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
            x{combo} COMBO!
          </div>
        )}
      </div>

      <style>{`
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
      `}</style>
    </div>
  );
}
