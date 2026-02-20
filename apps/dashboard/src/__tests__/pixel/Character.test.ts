import { describe, it, expect } from 'vitest';
import { Character } from '../../components/pixel/engine/Character';
import { RETRO_OFFICE } from '../../components/pixel/themes/retro-office';

const opusConfig = RETRO_OFFICE.models.opus;
const haikuConfig = RETRO_OFFICE.models.haiku;

describe('Character', () => {
  it('initializes with model properties', () => {
    const ch = new Character(10, 12, 'opus', opusConfig, 'agent-1');
    expect(ch.w).toBe(12);
    expect(ch.h).toBe(16);
    expect(ch.speed).toBe(45);
    expect(ch.bodyColor).toBe('#b82030');
    expect(ch.label).toBe('Opus');
    expect(ch.agentId).toBe('agent-1');
    expect(ch.state).toBe('idle');
  });

  it('sets pixel position from tile coordinates', () => {
    const ch = new Character(10, 12, 'opus', opusConfig, 'a1');
    expect(ch.x).toBe(10 * 16 + 8); // center of tile
    expect(ch.y).toBe(12 * 16 + 8);
  });

  it('opus is slower than haiku', () => {
    const opus = new Character(0, 0, 'opus', opusConfig, 'a1');
    const haiku = new Character(0, 0, 'haiku', haikuConfig, 'a2');
    expect(opus.speed).toBeLessThan(haiku.speed);
  });

  it('moveTo sets state to walking with a path', () => {
    const grid = Array.from({ length: 28 }, () => Array(42).fill(true));
    const ch = new Character(10, 12, 'opus', opusConfig, 'a1');
    let arrived = false;
    ch.moveTo(15, 12, grid, () => { arrived = true; });
    expect(ch.state).toBe('walking');
    expect(ch.path).not.toBeNull();
  });

  it('update moves character along path', () => {
    const grid = Array.from({ length: 28 }, () => Array(42).fill(true));
    const ch = new Character(10, 12, 'opus', opusConfig, 'a1');
    const startX = ch.x;
    ch.moveTo(15, 12, grid, () => {});
    ch.update(0.5);
    expect(ch.x).not.toBe(startX);
  });

  it('character arrives at destination and fires callback', () => {
    const grid = Array.from({ length: 28 }, () => Array(42).fill(true));
    const ch = new Character(10, 12, 'haiku', haikuConfig, 'a1');
    let arrived = false;
    ch.moveTo(11, 12, grid, () => { arrived = true; });
    // Haiku is fast (speed=100), 1 tile = 16px, so 0.2s is enough
    for (let i = 0; i < 20; i++) ch.update(0.05);
    expect(arrived).toBe(true);
    expect(ch.state).toBe('idle');
  });

  it('spawning state fades in alpha', () => {
    const ch = new Character(10, 12, 'opus', opusConfig, 'a1');
    ch.state = 'spawning';
    ch.alpha = 0;
    ch.update(0.1);
    expect(ch.alpha).toBeGreaterThan(0);
    expect(ch.alpha).toBeLessThan(1);
    // After 0.5s total, should be fully visible
    for (let i = 0; i < 10; i++) ch.update(0.05);
    expect(ch.alpha).toBe(1);
    expect(ch.state).toBe('idle');
  });

  it('despawning state fades out alpha', () => {
    const ch = new Character(10, 12, 'opus', opusConfig, 'a1');
    ch.state = 'despawning';
    ch.alpha = 1;
    ch.update(0.2);
    expect(ch.alpha).toBeLessThan(1);
  });

  it('statusIcon auto-clears after statusTimer expires', () => {
    const ch = new Character(10, 12, 'opus', opusConfig, 'a1');
    ch.statusIcon = '!';
    ch.statusTimer = 0.3;
    ch.update(0.1);
    expect(ch.statusIcon).toBe('!');
    ch.update(0.1);
    ch.update(0.15);
    expect(ch.statusIcon).toBeNull();
  });

  it('direction updates when walking', () => {
    const grid = Array.from({ length: 28 }, () => Array(42).fill(true));
    const ch = new Character(10, 12, 'opus', opusConfig, 'a1');
    ch.moveTo(15, 12, grid, () => {});
    expect(ch.dir).toBe('right');
  });
});
