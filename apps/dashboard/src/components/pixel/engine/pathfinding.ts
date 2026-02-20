export interface PathNode {
  c: number;
  r: number;
}

/** A* pathfinding on a boolean walkability grid. */
export function findPath(
  walkable: boolean[][],
  sc: number, sr: number,
  ec: number, er: number,
): PathNode[] | null {
  const rows = walkable.length;
  const cols = walkable[0].length;
  if (!walkable[sr]?.[sc] || !walkable[er]?.[ec]) return null;
  if (sc === ec && sr === er) return [{ c: sc, r: sr }];

  const key = (c: number, r: number) => (r << 12) | c;
  const open: { c: number; r: number; g: number; f: number; p: typeof open[0] | null }[] = [
    { c: sc, r: sr, g: 0, f: 0, p: null },
  ];
  const best = new Map<number, number>();
  best.set(key(sc, sr), 0);

  const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  while (open.length > 0) {
    let minIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[minIdx].f) minIdx = i;
    }
    const cur = open[minIdx];
    open[minIdx] = open[open.length - 1];
    open.pop();

    if (cur.c === ec && cur.r === er) {
      const path: PathNode[] = [];
      let n: typeof cur | null = cur;
      while (n) { path.unshift({ c: n.c, r: n.r }); n = n.p; }
      return path;
    }

    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      if (!walkable[nr][nc]) continue;
      const ng = cur.g + 1;
      const k = key(nc, nr);
      if (best.has(k) && best.get(k)! <= ng) continue;
      best.set(k, ng);
      const h = Math.abs(nc - ec) + Math.abs(nr - er);
      open.push({ c: nc, r: nr, g: ng, f: ng + h, p: cur });
    }
  }
  return null;
}

/**
 * Convert a numeric tile map (0=floor, 1=wall, 2=door, 3=carpet, 4+=blocked)
 * into a boolean walkability grid.
 */
export function buildWalkabilityGrid(tileMap: number[][]): boolean[][] {
  return tileMap.map(row => row.map(t => t === 0 || t === 2 || t === 3));
}
