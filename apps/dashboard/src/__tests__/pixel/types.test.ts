// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { describe, it, expect } from 'vitest';
import { TILE } from '../../components/pixel/engine/types';
import { RETRO_OFFICE } from '../../components/pixel/themes/retro-office';

describe('PixelTheme: retro-office', () => {
  it('has required palette colors', () => {
    expect(RETRO_OFFICE.palette.floor).toBeDefined();
    expect(RETRO_OFFICE.palette.wall).toBeDefined();
    expect(RETRO_OFFICE.palette.error).toBeDefined();
  });

  it('has all standard stations defined', () => {
    const names = RETRO_OFFICE.stations.map(s => s.name);
    expect(names).toContain('Read');
    expect(names).toContain('Bash');
    expect(names).toContain('Task');
    expect(names.length).toBeGreaterThanOrEqual(8);
  });

  it('station positions are within grid bounds', () => {
    for (const s of RETRO_OFFICE.stations) {
      expect(s.col).toBeGreaterThanOrEqual(1);
      expect(s.col).toBeLessThan(RETRO_OFFICE.grid.cols - 2);
      expect(s.row).toBeGreaterThanOrEqual(2);
      expect(s.row).toBeLessThan(RETRO_OFFICE.grid.rows - 2);
    }
  });

  it('has model configs for opus, sonnet, haiku', () => {
    expect(RETRO_OFFICE.models.opus).toBeDefined();
    expect(RETRO_OFFICE.models.sonnet).toBeDefined();
    expect(RETRO_OFFICE.models.haiku).toBeDefined();
    expect(RETRO_OFFICE.models.opus.speed).toBeLessThan(RETRO_OFFICE.models.haiku.speed);
  });

  it('TILE is 32 for HD resolution', () => {
    expect(TILE).toBe(32);
  });

  it('has homeDesks defined', () => {
    expect(RETRO_OFFICE.homeDesks).toBeDefined();
    expect(RETRO_OFFICE.homeDesks.length).toBeGreaterThanOrEqual(6);
  });

  it('has pointsOfInterest defined', () => {
    expect(RETRO_OFFICE.pointsOfInterest).toBeDefined();
    expect(RETRO_OFFICE.pointsOfInterest.length).toBeGreaterThanOrEqual(2);
  });
});
