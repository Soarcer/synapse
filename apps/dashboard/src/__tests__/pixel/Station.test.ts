import { describe, it, expect } from 'vitest';
import { Station } from '../../components/pixel/engine/Station';
import { RETRO_OFFICE } from '../../components/pixel/themes/retro-office';

describe('Station', () => {
  it('initializes with correct properties', () => {
    const def = RETRO_OFFICE.stations[0]; // Read
    const s = new Station(def, RETRO_OFFICE.palette);
    expect(s.name).toBe('Read');
    expect(s.icon).toBe('cabinet');
    expect(s.active).toBe(false);
    expect(s.glowAlpha).toBe(0);
  });

  it('returns correct pixel coordinates', () => {
    const def = { name: 'Test', col: 5, row: 8, icon: 'terminal' };
    const s = new Station(def, RETRO_OFFICE.palette);
    expect(s.px).toBe(5 * 16);
    expect(s.py).toBe(8 * 16);
  });

  it('activate/deactivate toggles state', () => {
    const s = new Station(RETRO_OFFICE.stations[0], RETRO_OFFICE.palette);
    expect(s.active).toBe(false);
    s.activate();
    expect(s.active).toBe(true);
    s.deactivate();
    expect(s.active).toBe(false);
  });

  it('update ramps glowAlpha up when active', () => {
    const s = new Station(RETRO_OFFICE.stations[0], RETRO_OFFICE.palette);
    s.activate();
    s.update(0.1);
    expect(s.glowAlpha).toBeGreaterThan(0);
    s.update(0.1);
    expect(s.glowAlpha).toBeGreaterThan(0);
  });

  it('update decays glowAlpha when inactive', () => {
    const s = new Station(RETRO_OFFICE.stations[0], RETRO_OFFICE.palette);
    s.activate();
    s.update(0.5);
    const peakGlow = s.glowAlpha;
    s.deactivate();
    s.update(0.1);
    expect(s.glowAlpha).toBeLessThan(peakGlow);
    // Repeated updates bring it toward 0
    for (let i = 0; i < 50; i++) s.update(0.1);
    expect(s.glowAlpha).toBeLessThan(0.01);
  });

  it('each standard station has a unique icon', () => {
    const stations = RETRO_OFFICE.stations.map(d => new Station(d, RETRO_OFFICE.palette));
    const icons = stations.map(s => s.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
