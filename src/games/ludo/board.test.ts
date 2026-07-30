import { describe, it, expect } from "vitest";
import {
  BASE_RECTS,
  ENTRY_SQUARES,
  GRID,
  HOME_COLUMN_COORDS,
  HOME_COLUMN_LENGTH,
  TRACK_COORDS,
  TRACK_LENGTH,
  type Coord,
} from "./rules";

const key = ([x, y]: Coord) => `${x},${y}`;
const adjacent = (a: Coord, b: Coord) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

describe("cross-board geometry", () => {
  it("has exactly 52 track cells", () => {
    expect(TRACK_COORDS).toHaveLength(TRACK_LENGTH);
  });

  it("never reuses a cell", () => {
    expect(new Set(TRACK_COORDS.map(key)).size).toBe(TRACK_LENGTH);
  });

  it("stays inside the 15×15 grid", () => {
    for (const [x, y] of TRACK_COORDS) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(GRID);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(GRID);
    }
  });

  it("forms one continuous loop — every step moves to a touching cell", () => {
    // Catches an off-by-one in the path: a pawn must never teleport. Steps are
    // orthogonal except where two arms meet, where the lanes turn a corner
    // diagonally around the centre home — so allow king-moves and pin the
    // diagonals down separately below.
    for (let i = 0; i < TRACK_COORDS.length; i++) {
      const [ax, ay] = TRACK_COORDS[i]!;
      const [bx, by] = TRACK_COORDS[(i + 1) % TRACK_COORDS.length]!;
      const step = Math.max(Math.abs(ax - bx), Math.abs(ay - by));
      expect(step, `square ${i} → ${(i + 1) % TRACK_LENGTH} jumps too far`).toBe(1);
    }
  });

  it("turns a corner exactly four times, once per arm junction", () => {
    const diagonals: number[] = [];
    for (let i = 0; i < TRACK_COORDS.length; i++) {
      const here = TRACK_COORDS[i]!;
      const next = TRACK_COORDS[(i + 1) % TRACK_COORDS.length]!;
      if (!adjacent(here, next)) diagonals.push(i);
    }
    // One corner per arm junction and no more — a fifth would mean a stray
    // diagonal somewhere the path should have run straight.
    expect(diagonals).toHaveLength(4);
  });

  it("keeps the track on the arms, never inside a corner base", () => {
    for (const [x, y] of TRACK_COORDS) {
      const inArm = (x >= 6 && x <= 8) || (y >= 6 && y <= 8);
      expect(inArm, `track cell ${x},${y} is inside a base`).toBe(true);
    }
  });

  it("never runs through the centre home", () => {
    for (const [x, y] of TRACK_COORDS) {
      const inCentre = x >= 6 && x <= 8 && y >= 6 && y <= 8;
      expect(inCentre).toBe(false);
    }
  });
});

describe("entry squares", () => {
  it("places the four entries evenly, one per arm", () => {
    expect(ENTRY_SQUARES).toEqual([0, 13, 26, 39]);
    const coords = ENTRY_SQUARES.map((i) => TRACK_COORDS[i]!);
    // One entry on each arm: left, top, right, bottom.
    expect(coords[0]).toEqual([1, 6]);
    expect(coords[1]).toEqual([8, 1]);
    expect(coords[2]).toEqual([13, 8]);
    expect(coords[3]).toEqual([6, 13]);
  });

  it("sits each entry beside its own corner base", () => {
    ENTRY_SQUARES.forEach((trackIndex, seat) => {
      const [ex, ey] = TRACK_COORDS[trackIndex]!;
      const [bx, by, bw, bh] = BASE_RECTS[seat]!;
      // The entry should touch the base's bounding box.
      const nearX = ex >= bx - 1 && ex <= bx + bw;
      const nearY = ey >= by - 1 && ey <= by + bh;
      expect(nearX && nearY, `seat ${seat} entry ${ex},${ey} is not beside its base`).toBe(true);
    });
  });
});

describe("home columns", () => {
  it("gives every seat five cells", () => {
    expect(HOME_COLUMN_COORDS).toHaveLength(4);
    for (const column of HOME_COLUMN_COORDS) expect(column).toHaveLength(HOME_COLUMN_LENGTH);
  });

  it("runs inward toward the centre without overlapping the track", () => {
    const trackKeys = new Set(TRACK_COORDS.map(key));
    for (const column of HOME_COLUMN_COORDS) {
      for (const cell of column) expect(trackKeys.has(key(cell))).toBe(false);
    }
  });

  it("is continuous and ends adjacent to the centre", () => {
    for (const column of HOME_COLUMN_COORDS) {
      for (let i = 1; i < column.length; i++) {
        expect(adjacent(column[i - 1]!, column[i]!)).toBe(true);
      }
      const [lx, ly] = column[column.length - 1]!;
      // Last home cell should be next to the 3×3 centre at (6..8, 6..8).
      const touchesCentre = lx >= 5 && lx <= 9 && ly >= 5 && ly <= 9;
      expect(touchesCentre).toBe(true);
    }
  });

  it("does not share a cell between two seats", () => {
    const all = HOME_COLUMN_COORDS.flat().map(key);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("bases", () => {
  it("puts one 6×6 base in each corner", () => {
    expect(BASE_RECTS).toHaveLength(4);
    for (const [x, y, w, h] of BASE_RECTS) {
      expect(w).toBe(6);
      expect(h).toBe(6);
      const corner = (x === 0 || x === 9) && (y === 0 || y === 9);
      expect(corner).toBe(true);
    }
  });

  it("does not overlap the track", () => {
    const trackKeys = new Set(TRACK_COORDS.map(key));
    for (const [bx, by, bw, bh] of BASE_RECTS) {
      for (let x = bx; x < bx + bw; x++) {
        for (let y = by; y < by + bh; y++) {
          expect(trackKeys.has(`${x},${y}`)).toBe(false);
        }
      }
    }
  });
});
