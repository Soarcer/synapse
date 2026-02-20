import type { PixelTheme, StationDef } from './types';
import { TILE } from './types';
import { buildWalkabilityGrid } from './pathfinding';

// Tile values: 0=floor, 1=wall, 2=door, 3=carpet, 4=decoration, 5=station
export class TileMap {
  readonly cols: number;
  readonly rows: number;
  private tiles: number[][];
  private walkGrid: boolean[][] | null = null;

  constructor(private theme: PixelTheme) {
    this.cols = theme.grid.cols;
    this.rows = theme.grid.rows;
    this.tiles = this.buildTiles();
  }

  private buildTiles(): number[][] {
    const { cols, rows } = this;
    const tiles: number[][] = [];

    for (let r = 0; r < rows; r++) {
      tiles[r] = [];
      for (let c = 0; c < cols; c++) {
        if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
          tiles[r][c] = 1; // wall
        } else {
          tiles[r][c] = 0; // floor
        }
      }
    }

    // Door
    const door = this.theme.door;
    for (let i = 0; i < door.width; i++) {
      tiles[door.row][door.col + i] = 2;
    }

    // Thicker top wall for 3D effect (row 1)
    for (let c = 1; c < cols - 1; c++) {
      if (tiles[0][c] !== 2) tiles[1][c] = 1;
    }

    // Carpet strip in center
    for (let r = 3; r < rows - 2; r++) {
      for (let c = 16; c < 26; c++) {
        if (tiles[r][c] === 0) tiles[r][c] = 3;
      }
    }

    // Mark station tiles as blocked (5)
    for (const s of this.theme.stations) {
      for (let dr = 0; dr < 2; dr++) {
        for (let dc = 0; dc < 2; dc++) {
          const r = s.row + dr, c = s.col + dc;
          if (r >= 0 && r < rows && c >= 0 && c < cols) {
            tiles[r][c] = 5;
          }
        }
      }
    }

    // Mark decoration tiles as blocked (4)
    for (const d of this.theme.decorations) {
      if (d.row >= 0 && d.row < rows && d.col >= 0 && d.col < cols) {
        tiles[d.row][d.col] = 4;
      }
      // board/output decorations are 2x2
      if (d.type === 'board' || d.type === 'output') {
        if (d.col + 1 < cols) tiles[d.row][d.col + 1] = 4;
        if (d.row + 1 < rows) {
          tiles[d.row + 1][d.col] = 4;
          if (d.col + 1 < cols) tiles[d.row + 1][d.col + 1] = 4;
        }
      }
    }

    this.walkGrid = null; // invalidate cache
    return tiles;
  }

  isWalkable(c: number, r: number): boolean {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
    const t = this.tiles[r][c];
    return t === 0 || t === 2 || t === 3;
  }

  getWalkabilityGrid(): boolean[][] {
    if (!this.walkGrid) {
      this.walkGrid = buildWalkabilityGrid(this.tiles);
    }
    return this.walkGrid;
  }

  getApproachTile(station: StationDef): { c: number; r: number } {
    // Prefer south, then east, west, north
    const tries = [
      { c: station.col, r: station.row + 2 },
      { c: station.col + 1, r: station.row + 2 },
      { c: station.col + 2, r: station.row + 1 },
      { c: station.col + 2, r: station.row },
      { c: station.col - 1, r: station.row + 1 },
      { c: station.col - 1, r: station.row },
      { c: station.col, r: station.row - 1 },
      { c: station.col + 1, r: station.row - 1 },
    ];
    for (const t of tries) {
      if (this.isWalkable(t.c, t.r)) return t;
    }
    return tries[0]; // fallback
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const p = this.theme.palette;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = c * TILE, y = r * TILE;
        const tile = this.tiles[r][c];

        if (tile === 1) {
          // Wall
          ctx.fillStyle = r === 0 ? p.wallTop : p.wall;
          ctx.fillRect(x, y, TILE, TILE);
          if (r === 0 || r === this.rows - 1) {
            ctx.fillStyle = p.wallTrim;
            ctx.fillRect(x, r === 0 ? y + TILE - 2 : y, TILE, 2);
          }
          if (c === 0 || c === this.cols - 1) {
            ctx.fillStyle = p.wallTrim;
            ctx.fillRect(c === 0 ? x + TILE - 1 : x, y, 1, TILE);
          }
        } else if (tile === 2) {
          // Door
          ctx.fillStyle = p.door;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = p.doorFrame;
          ctx.fillRect(x, y, TILE, 2);
          ctx.fillRect(x, y, 2, TILE);
          ctx.fillRect(x + TILE - 2, y, 2, TILE);
          ctx.fillStyle = p.gold;
          ctx.fillRect(x + TILE - 4, y + TILE / 2, 2, 2);
        } else if (tile === 3) {
          // Carpet
          ctx.fillStyle = (c + r) % 2 === 0 ? p.carpet[0] : p.carpet[1];
          ctx.fillRect(x, y, TILE, TILE);
        } else {
          // Floor (0, 4, 5)
          ctx.fillStyle = (c + r) % 2 === 0 ? p.floor[0] : p.floor[1];
          ctx.fillRect(x, y, TILE, TILE);
        }
      }
    }
  }
}
