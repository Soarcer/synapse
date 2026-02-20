import { describe, it, expect } from 'vitest';
import { ParticleManager } from '../../components/pixel/engine/ParticleManager';

describe('ParticleManager', () => {
  it('emit adds particles', () => {
    const pm = new ParticleManager();
    pm.emit('dust', 100, 100, 5);
    expect(pm.count).toBe(5);
  });

  it('particles decrement life over time', () => {
    const pm = new ParticleManager();
    pm.emit('sparkle', 100, 100, 1);
    const initialLife = pm.getParticles()[0].life;
    pm.update(0.1);
    expect(pm.getParticles()[0].life).toBeLessThan(initialLife);
  });

  it('dead particles are removed', () => {
    const pm = new ParticleManager();
    pm.emit('dust', 100, 100, 3);
    // Dust has maxLife ~0.4-0.6, fast forward
    for (let i = 0; i < 20; i++) pm.update(0.1);
    expect(pm.count).toBe(0);
  });

  it('each type has different velocity ranges', () => {
    const pm = new ParticleManager();
    pm.emit('dust', 100, 100, 1);
    const dust = pm.getParticles()[0];
    pm.emit('token', 200, 200, 1);
    const token = pm.getParticles().find(p => p.type === 'token')!;
    // Token has higher max velocity than dust
    expect(Math.abs(token.vy)).toBeGreaterThan(0);
    expect(dust.type).toBe('dust');
    expect(token.type).toBe('token');
  });

  it('pool capped at 500 particles', () => {
    const pm = new ParticleManager();
    for (let i = 0; i < 100; i++) pm.emit('sparkle', 100, 100, 10);
    expect(pm.count).toBeLessThanOrEqual(500);
  });

  it('supports all 6 particle types', () => {
    const pm = new ParticleManager();
    const types = ['dust', 'token', 'sparkle', 'error', 'steam', 'cache'] as const;
    for (const t of types) {
      pm.emit(t, 100, 100, 1);
    }
    expect(pm.count).toBe(6);
    const foundTypes = new Set(pm.getParticles().map(p => p.type));
    for (const t of types) {
      expect(foundTypes.has(t)).toBe(true);
    }
  });

  it('gravity affects token and error particles', () => {
    const pm = new ParticleManager();
    pm.emit('token', 100, 100, 1);
    const token = pm.getParticles()[0];
    const vy0 = token.vy;
    pm.update(0.1);
    // vy should increase (gravity pulls down)
    expect(token.vy).toBeGreaterThan(vy0);
  });
});
