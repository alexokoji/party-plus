"use client";

/**
 * A single domino, drawn as two pip halves with a divider.
 *
 * Pips are laid out on a fixed 3×3 grid per half, which is how real tiles are
 * arranged — a 6 is two columns of three, not six dots in a row.
 */

const PIP_GRID: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export interface DominoTileProps {
  a: number;
  b: number;
  /** Chain tiles lie along the layout; hand tiles stand upright. */
  orientation?: "vertical" | "horizontal";
  size?: "small" | "normal" | "big";
}

function Half({ pips }: { pips: number }) {
  const on = new Set(PIP_GRID[pips] ?? []);
  return (
    <span className="domino-half" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={on.has(i) ? "pip on" : "pip"} />
      ))}
    </span>
  );
}

export function DominoTile({ a, b, orientation = "vertical", size = "normal" }: DominoTileProps) {
  return (
    <span
      className={`domino ${orientation} domino-${size}`}
      role="img"
      aria-label={`domino ${a} and ${b}`}
    >
      <Half pips={a} />
      <span className="domino-divider" />
      <Half pips={b} />
    </span>
  );
}
