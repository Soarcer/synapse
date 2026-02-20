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
  private loopDuration = 35;
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
      // Clean up any leftover characters
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

    // t=3: Opus spawns
    s.push({ time: 3, cmd: { type: 'spawnAgent', agentId: 'opus-1', model: 'claude-opus-4-6', agentType: 'root' } });

    // t=4: Opus → Read (3s work)
    s.push({ time: 4, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Read' } });
    s.push({ time: 7, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Read', success: true } });
    s.push({ time: 7, cmd: { type: 'cacheHit', agentId: 'opus-1' } });

    // t=7.5: Opus → Edit (2.5s work)
    s.push({ time: 7.5, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Edit' } });
    s.push({ time: 10, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Edit', success: true } });

    // t=10.5: Opus → Task (spawn Sonnet)
    s.push({ time: 10.5, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Task' } });
    s.push({ time: 12, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Task', success: true } });

    // t=12: Sonnet spawns
    s.push({ time: 12, cmd: { type: 'spawnAgent', agentId: 'sonnet-1', model: 'claude-sonnet-4-6', agentType: 'Explore', parentAgentId: 'opus-1' } });

    // t=12.5: Sonnet → Grep (2.5s work)
    s.push({ time: 12.5, cmd: { type: 'dispatchToStation', agentId: 'sonnet-1', stationName: 'Grep' } });
    s.push({ time: 15, cmd: { type: 'stationComplete', agentId: 'sonnet-1', stationName: 'Grep', success: true } });

    // t=13: Opus → Write (4s work)
    s.push({ time: 13, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Write' } });
    s.push({ time: 17, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Write', success: true } });

    // t=15.5: Sonnet → Glob (1.5s work), then spawns Haiku
    s.push({ time: 15.5, cmd: { type: 'dispatchToStation', agentId: 'sonnet-1', stationName: 'Glob' } });
    s.push({ time: 17, cmd: { type: 'stationComplete', agentId: 'sonnet-1', stationName: 'Glob', success: true } });
    s.push({ time: 17, cmd: { type: 'cacheHit', agentId: 'sonnet-1' } });

    // t=17: Haiku spawns
    s.push({ time: 17, cmd: { type: 'spawnAgent', agentId: 'haiku-1', model: 'claude-haiku-4-5', agentType: 'Bash', parentAgentId: 'sonnet-1' } });

    // t=17.5: Haiku → Bash (1.2s — fast!)
    s.push({ time: 17.5, cmd: { type: 'dispatchToStation', agentId: 'haiku-1', stationName: 'Bash' } });
    s.push({ time: 18.7, cmd: { type: 'stationComplete', agentId: 'haiku-1', stationName: 'Bash', success: true } });

    // t=19: Haiku → Read (0.6s), cache hit
    s.push({ time: 19, cmd: { type: 'dispatchToStation', agentId: 'haiku-1', stationName: 'Read' } });
    s.push({ time: 19.6, cmd: { type: 'stationComplete', agentId: 'haiku-1', stationName: 'Read', success: true } });
    s.push({ time: 19.6, cmd: { type: 'cacheHit', agentId: 'haiku-1' } });

    // t=20: Haiku finishes
    s.push({ time: 20, cmd: { type: 'tokenStream', agentId: 'haiku-1', count: 5 } });
    s.push({ time: 20, cmd: { type: 'despawnAgent', agentId: 'haiku-1', success: true } });
    s.push({ time: 20, cmd: { type: 'updateCost', costUsd: 0.05 } });

    // t=20.5: Sonnet → Web (3s work)
    s.push({ time: 20.5, cmd: { type: 'dispatchToStation', agentId: 'sonnet-1', stationName: 'Web' } });
    s.push({ time: 23.5, cmd: { type: 'stationComplete', agentId: 'sonnet-1', stationName: 'Web', success: true } });

    // t=24: Sonnet finishes
    s.push({ time: 24, cmd: { type: 'tokenStream', agentId: 'sonnet-1', count: 8 } });
    s.push({ time: 24, cmd: { type: 'despawnAgent', agentId: 'sonnet-1', success: true } });
    s.push({ time: 24, cmd: { type: 'updateCost', costUsd: 0.12 } });

    // t=25: Opus → Bash (error!)
    s.push({ time: 25, cmd: { type: 'dispatchToStation', agentId: 'opus-1', stationName: 'Bash' } });
    s.push({ time: 26.5, cmd: { type: 'stationComplete', agentId: 'opus-1', stationName: 'Bash', success: false } });

    // t=27: Opus finishes
    s.push({ time: 27, cmd: { type: 'tokenStream', agentId: 'opus-1', count: 15 } });
    s.push({ time: 27.5, cmd: { type: 'despawnAgent', agentId: 'opus-1', success: true } });
    s.push({ time: 27.5, cmd: { type: 'updateCost', costUsd: 0.25 } });

    // t=29: Session end
    s.push({ time: 29, cmd: { type: 'sessionEnd', sessionId: 'demo-session' } });

    // Sort by time
    s.sort((a, b) => a.time - b.time);
  }
}
