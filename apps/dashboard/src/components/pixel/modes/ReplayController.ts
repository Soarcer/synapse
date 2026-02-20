import type { AgentEvent } from '@synapse-ai/core';
import type { SceneManager } from '../engine/SceneManager';
import { mapEventToCommands } from '../bridge/eventMapper';

export class ReplayController {
  private events: AgentEvent[] = [];
  private cursor = 0;
  private elapsed = 0;
  private startTimestamp = 0;
  private totalDuration = 0;
  private speed = 1;
  private playing = false;
  private loaded = false;

  onProgress: ((elapsed: number, total: number) => void) | null = null;

  constructor(private scene: SceneManager) {}

  async loadSession(sessionId: string): Promise<void> {
    const res = await fetch(`/api/events?sessionId=${encodeURIComponent(sessionId)}`);
    if (!res.ok) throw new Error(`Failed to load session: ${res.status}`);
    const data: AgentEvent[] = await res.json();

    // Sort oldest-first
    this.events = data.sort((a, b) => a.timestamp - b.timestamp);
    if (this.events.length === 0) return;

    this.startTimestamp = this.events[0].timestamp;
    this.totalDuration = (this.events[this.events.length - 1].timestamp - this.startTimestamp) / 1000;
    this.loaded = true;
    this.cursor = 0;
    this.elapsed = 0;
  }

  loadEvents(events: AgentEvent[]): void {
    this.events = [...events].sort((a, b) => a.timestamp - b.timestamp);
    if (this.events.length === 0) return;
    this.startTimestamp = this.events[0].timestamp;
    this.totalDuration = (this.events[this.events.length - 1].timestamp - this.startTimestamp) / 1000;
    this.loaded = true;
    this.cursor = 0;
    this.elapsed = 0;
  }

  start(speed = 1): void {
    if (!this.loaded) return;
    this.speed = speed;
    this.playing = true;
    this.scene.characters.clear();
    this.scene.currentCost = 0;
    this.scene.onUpdate = (dt) => this.update(dt);
  }

  pause(): void {
    this.playing = false;
  }

  resume(): void {
    this.playing = true;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  seek(timeOffset: number): void {
    this.scene.characters.clear();
    this.scene.currentCost = 0;
    this.elapsed = 0;
    this.cursor = 0;
    // Replay all events up to the seek point instantly
    const targetTime = this.startTimestamp + timeOffset * 1000;
    while (this.cursor < this.events.length && this.events[this.cursor].timestamp <= targetTime) {
      const event = this.events[this.cursor];
      const cmds = mapEventToCommands(event);
      for (const cmd of cmds) this.scene.handleCommand(cmd);
      this.cursor++;
    }
    this.elapsed = timeOffset;
  }

  stop(): void {
    this.playing = false;
    this.scene.onUpdate = null;
  }

  get isPlaying(): boolean { return this.playing; }
  get isLoaded(): boolean { return this.loaded; }
  get duration(): number { return this.totalDuration; }
  get currentTime(): number { return this.elapsed; }
  get currentSpeed(): number { return this.speed; }

  update(dt: number): void {
    if (!this.playing || !this.loaded) return;
    this.elapsed += dt * this.speed;

    const currentTimestamp = this.startTimestamp + this.elapsed * 1000;

    while (this.cursor < this.events.length && this.events[this.cursor].timestamp <= currentTimestamp) {
      const event = this.events[this.cursor];
      const cmds = mapEventToCommands(event);
      for (const cmd of cmds) this.scene.handleCommand(cmd);
      this.cursor++;
    }

    this.onProgress?.(this.elapsed, this.totalDuration);

    // Auto-stop at end
    if (this.elapsed >= this.totalDuration) {
      this.playing = false;
    }
  }
}
