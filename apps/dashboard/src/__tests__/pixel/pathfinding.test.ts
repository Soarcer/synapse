import { describe, it, expect } from 'vitest';
import { findPath, buildWalkabilityGrid } from '../../components/pixel/engine/pathfinding';

describe('findPath', () => {
  const open = Array.from({ length: 5 }, () => Array(5).fill(true));

  it('returns direct path on open grid', () => {
    const path = findPath(open, 0, 0, 4, 0);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ c: 0, r: 0 });
    expect(path![path!.length - 1]).toEqual({ c: 4, r: 0 });
  });

  it('returns null for unreachable target', () => {
    const blocked = open.map(r => [...r]);
    blocked[0][2] = false;
    blocked[1][2] = false;
    blocked[2][2] = false;
    blocked[3][2] = false;
    blocked[4][2] = false;
    expect(findPath(blocked, 0, 0, 4, 0)).toBeNull();
  });

  it('finds path around obstacles', () => {
    const grid = open.map(r => [...r]);
    grid[0][2] = false;
    grid[1][2] = false;
    grid[2][2] = false;
    // Leave row 3 open
    const path = findPath(grid, 0, 0, 4, 0);
    expect(path).not.toBeNull();
    expect(path!.every(p => grid[p.r][p.c])).toBe(true);
  });

  it('returns single-element path for same start/end', () => {
    const path = findPath(open, 2, 2, 2, 2);
    expect(path).toEqual([{ c: 2, r: 2 }]);
  });

  it('returns null when start is blocked', () => {
    const grid = open.map(r => [...r]);
    grid[0][0] = false;
    expect(findPath(grid, 0, 0, 4, 4)).toBeNull();
  });
});

describe('buildWalkabilityGrid', () => {
  it('marks walls as non-walkable', () => {
    const tileMap = [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ];
    const grid = buildWalkabilityGrid(tileMap);
    expect(grid[0][0]).toBe(false); // wall
    expect(grid[1][1]).toBe(true);  // floor
    expect(grid[0][1]).toBe(false); // wall
  });
});
