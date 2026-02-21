// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { SceneManager } from '../engine/SceneManager';
import type { SceneCommand } from '../engine/types';

interface ScheduledCommand {
  time: number;
  cmd: SceneCommand;
}

/** Generates a synthetic agent sequence that loops on a timer. */
export class DemoSequencer {
  private elapsed = 0;
  private cursor = 0;
  private schedule: ScheduledCommand[] = [];
  private loopDuration = 90;
  private running = false;

  constructor(private scene: SceneManager) {
    this.buildSchedule();
  }

  start(): void {
    this.running = true;
    this.elapsed = 0;
    this.cursor = 0;
    this.scene.onUpdate = (dt) => this.update(dt);
  }

  stop(): void {
    this.running = false;
    this.scene.onUpdate = null;
  }

  update(dt: number): void {
    if (!this.running) return;
    this.elapsed += dt;

    // Dispatch commands whose time has passed
    while (this.cursor < this.schedule.length && this.schedule[this.cursor].time <= this.elapsed) {
      this.scene.handleCommand(this.schedule[this.cursor].cmd);
      this.cursor++;
    }

    // Loop
    if (this.elapsed >= this.loopDuration) {
      this.elapsed = 0;
      this.cursor = 0;
      // Clean up any leftover characters and idle state
      for (const ch of this.scene.characters.values()) {
        ch.onIdleExpired = null;
        ch.idleBehavior = null;
        ch.idleTimer = 0;
      }
      this.scene.characters.clear();
      this.scene.currentCost = 0;
    }
  }

  private buildSchedule(): void {
    const s = this.schedule;

    // t=1: Session start
    s.push({ time: 1, cmd: { type: 'sessionStart', sessionId: 'demo-session' } });

    // t=2: Prompt arrives
    s.push({ time: 2, cmd: { type: 'promptArrived', text: 'Fix the auth bug in login.ts', agentId: 'opus-1' } });

    // t=3: Opus spawns — will idle at desk until first tool call
    s.push({ time: 3, cmd: { type: 'spawnAgent', agentId: 'opus-1', model: 'claude-opus-4-6', agentType: 'root' } });

    // t=8: Opus → Read (idle for 5s first, then works 4s)
    s.push({ time: 8, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Read' } });
    s.push({ time: 12, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Read', success: true } });
    s.push({ time: 12, cmd: { type: 'cacheHit', agentId: 'opus-1' } });

    // t=12-18: Opus idles (sits at desk, maybe wanders) — automatic via idle system

    // t=18: Opus → Edit (6s gap, then 4s work)
    s.push({ time: 18, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Edit' } });
    s.push({ time: 22, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Edit', success: true } });

    // t=24: Opus → Task (spawns Sonnet)
    s.push({ time: 24, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Task' } });
    s.push({ time: 27, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Task', success: true } });

    // t=27: Sonnet spawns — idles while Opus continues
    s.push({ time: 27, cmd: { type: 'spawnAgent', agentId: 'sonnet-1', model: 'claude-sonnet-4-6', agentType: 'Explore', parentAgentId: 'opus-1' } });

    // t=30: Opus → Write (idle 3s, then 6s work)
    s.push({ time: 30, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Write' } });
    s.push({ time: 36, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Write', success: true } });

    // t=32: Sonnet → Grep (idle 5s after spawn, then 4s work)
    s.push({ time: 32, cmd: { type: 'dispatchToStation', agentId: 'sonnet-1', stationName: 'Grep' } });
    s.push({ time: 36, cmd: { type: 'stationComplete', agentId: 'sonnet-1', stationName: 'Grep', success: true } });

    // t=36-40: Both idle — they should wander/socialize with each other

    // t=40: Sonnet → Glob
    s.push({ time: 40, cmd: { type: 'dispatchToStation', agentId: 'sonnet-1', stationName: 'Glob' } });
    s.push({ time: 43, cmd: { type: 'stationComplete', agentId: 'sonnet-1', stationName: 'Glob', success: true } });
    s.push({ time: 43, cmd: { type: 'cacheHit', agentId: 'sonnet-1' } });

    // t=43: Haiku spawns
    s.push({ time: 43, cmd: { type: 'spawnAgent', agentId: 'haiku-1', model: 'claude-haiku-4-5', agentType: 'Bash', parentAgentId: 'sonnet-1' } });

    // t=45: Haiku → Bash (fast worker)
    s.push({ time: 45, cmd: { type: 'dispatchToStation', agentId: 'haiku-1', stationName: 'Bash' } });
    s.push({ time: 47, cmd: { type: 'stationComplete', agentId: 'haiku-1', stationName: 'Bash', success: true } });

    // t=48: Opus → Bash (error, while haiku idles)
    s.push({ time: 48, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Bash' } });
    s.push({ time: 51, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Bash', success: false } });

    // t=50: Haiku → Read, cache hit
    s.push({ time: 50, cmd: { type: 'dispatchToStation', agentId: 'haiku-1', stationName: 'Read' } });
    s.push({ time: 51.5, cmd: { type: 'stationComplete', agentId: 'haiku-1', stationName: 'Read', success: true } });
    s.push({ time: 51.5, cmd: { type: 'cacheHit', agentId: 'haiku-1' } });

    // t=53: Sonnet → Web
    s.push({ time: 53, cmd: { type: 'dispatchToStation', agentId: 'sonnet-1', stationName: 'Web' } });
    s.push({ time: 58, cmd: { type: 'stationComplete', agentId: 'sonnet-1', stationName: 'Web', success: true } });

    // t=55: Haiku finishes — despawn
    s.push({ time: 55, cmd: { type: 'tokenStream', agentId: 'haiku-1', count: 5 } });
    s.push({ time: 55, cmd: { type: 'despawnAgent', agentId: 'haiku-1', success: true } });
    s.push({ time: 55, cmd: { type: 'updateCost', costUsd: 0.05 } });

    // t=58-65: Opus and Sonnet idle together — wander, socialize, coffee

    // t=65: Opus → Read (final review)
    s.push({ time: 65, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Read' } });
    s.push({ time: 68, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Read', success: true } });

    // t=68: Sonnet finishes
    s.push({ time: 68, cmd: { type: 'tokenStream', agentId: 'sonnet-1', count: 8 } });
    s.push({ time: 68, cmd: { type: 'despawnAgent', agentId: 'sonnet-1', success: true } });
    s.push({ time: 68, cmd: { type: 'updateCost', costUsd: 0.12 } });

    // t=70: Opus → Write (final edit, alone now)
    s.push({ time: 70, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Write' } });
    s.push({ time: 75, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Write', success: true } });

    // t=75-80: Opus idles alone

    // t=80: Opus finishes
    s.push({ time: 80, cmd: { type: 'tokenStream', agentId: 'opus-1', count: 15 } });
    s.push({ time: 80, cmd: { type: 'despawnAgent', agentId: 'opus-1', success: true } });
    s.push({ time: 80, cmd: { type: 'updateCost', costUsd: 0.25 } });

    // t=82: Session end
    s.push({ time: 82, cmd: { type: 'sessionEnd', sessionId: 'demo-session' } });

    // Sort by time
    s.sort((a, b) => a.time - b.time);
  }
}
