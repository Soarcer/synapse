import { describe, it, expect } from 'vitest';
import { TileMap } from '../../components/pixel/engine/TileMap';
import { RETRO_OFFICE } from '../../components/pixel/themes/retro-office';

describe('TileMap', () => {
  const tm = new TileMap(RETRO_OFFICE);

  it('marks border walls as non-walkable', () => {
    expect(tm.isWalkable(0, 0)).toBe(false);  // top-left wall
    expect(tm.isWalkable(41, 27)).toBe(false); // bottom-right wall
    expect(tm.isWalkable(0, 14)).toBe(false);  // left wall
  });

  it('marks interior floor as walkable', () => {
    expect(tm.isWalkable(20, 12)).toBe(true);
    expect(tm.isWalkable(15, 20)).toBe(true);
  });

  it('marks door tiles as walkable', () => {
    expect(tm.isWalkable(20, 0)).toBe(true);
    expect(tm.isWalkable(21, 0)).toBe(true);
  });

  it('marks carpet tiles as walkable', () => {
    expect(tm.isWalkable(18, 5)).toBe(true);
    expect(tm.isWalkable(22, 10)).toBe(true);
  });

  it('marks station tiles as non-walkable', () => {
    // Read station is at col=5, row=8 (2x2 area)
    expect(tm.isWalkable(5, 8)).toBe(false);
    expect(tm.isWalkable(6, 8)).toBe(false);
    expect(tm.isWalkable(5, 9)).toBe(false);
    expect(tm.isWalkable(6, 9)).toBe(false);
  });

  it('getApproachTile returns a walkable tile', () => {
    const station = RETRO_OFFICE.stations[0]; // Read
    const approach = tm.getApproachTile(station);
    expect(tm.isWalkable(approach.c, approach.r)).toBe(true);
    // Should be adjacent to the station (within 1 tile of the 2x2 area)
    const dx = Math.min(
      Math.abs(approach.c - station.col),
      Math.abs(approach.c - (station.col + 1)),
    );
    const dy = Math.min(
      Math.abs(approach.r - station.row),
      Math.abs(approach.r - (station.row + 1)),
    );
    expect(dx + dy).toBeLessThanOrEqual(2);
  });

  it('getWalkabilityGrid dimensions match grid config', () => {
    const grid = tm.getWalkabilityGrid();
    expect(grid.length).toBe(RETRO_OFFICE.grid.rows);
    expect(grid[0].length).toBe(RETRO_OFFICE.grid.cols);
  });

  it('out of bounds queries are non-walkable', () => {
    expect(tm.isWalkable(-1, 0)).toBe(false);
    expect(tm.isWalkable(0, -1)).toBe(false);
    expect(tm.isWalkable(100, 0)).toBe(false);
  });
});
