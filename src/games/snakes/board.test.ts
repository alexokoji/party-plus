import { describe, it, expect } from "vitest";
import { BOARD_SIZE, CLASSIC_BOARD } from "./rules";

/**
 * Mirrors the renderer's numbering so the layout can be tested without a DOM.
 * Square 1 is bottom-left and the numbering snakes back and forth up the
 * grid, which is how a printed board is laid out — and easy to get subtly
 * wrong in a way that only shows up as a mangled picture.
 */
function squarePosition(square: number): { col: number; row: number } {
  const index = square - 1;
  const rowFromBottom = Math.floor(index / 10);
  const withinRow = index % 10;
  const col = rowFromBottom % 2 === 0 ? withinRow : 9 - withinRow;
  return { col: col + 1, row: 10 - rowFromBottom };
}

describe("board numbering", () => {
  it("starts at the bottom-left and finishes at the top-left", () => {
    expect(squarePosition(1)).toEqual({ col: 1, row: 10 });
    expect(squarePosition(100)).toEqual({ col: 1, row: 1 });
  });

  it("runs left-to-right on odd rows and right-to-left on even ones", () => {
    // Bottom row: 1..10 left to right.
    expect(squarePosition(1).col).toBe(1);
    expect(squarePosition(10).col).toBe(10);
    // Second row up: 11..20 reverses.
    expect(squarePosition(11).col).toBe(10);
    expect(squarePosition(20).col).toBe(1);
    // Third row resumes left to right.
    expect(squarePosition(21).col).toBe(1);
  });

  it("keeps consecutive squares adjacent, including at row ends", () => {
    for (let square = 1; square < BOARD_SIZE; square++) {
      const a = squarePosition(square);
      const b = squarePosition(square + 1);
      const step = Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
      // Either one across, or one up at the turn.
      expect(step, `square ${square} → ${square + 1} is not adjacent`).toBe(1);
    }
  });

  it("fills all one hundred cells exactly once", () => {
    const seen = new Set<string>();
    for (let square = 1; square <= BOARD_SIZE; square++) {
      const { col, row } = squarePosition(square);
      expect(col).toBeGreaterThanOrEqual(1);
      expect(col).toBeLessThanOrEqual(10);
      expect(row).toBeGreaterThanOrEqual(1);
      expect(row).toBeLessThanOrEqual(10);
      seen.add(`${col},${row}`);
    }
    expect(seen.size).toBe(BOARD_SIZE);
  });

  it("puts every snake head above its tail on the board", () => {
    for (const [head, tail] of Object.entries(CLASSIC_BOARD.snakes)) {
      const h = squarePosition(Number(head));
      const t = squarePosition(tail);
      // Lower row number == higher up the board, so a head must not be below
      // its tail — otherwise the artwork would point the wrong way.
      expect(h.row, `snake ${head}→${tail} is drawn upside down`).toBeLessThanOrEqual(t.row);
    }
  });

  it("puts every ladder top above its base", () => {
    for (const [base, top] of Object.entries(CLASSIC_BOARD.ladders)) {
      const b = squarePosition(Number(base));
      const t = squarePosition(top);
      expect(t.row, `ladder ${base}→${top} is drawn upside down`).toBeLessThanOrEqual(b.row);
    }
  });
});
