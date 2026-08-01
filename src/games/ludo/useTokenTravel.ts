"use client";

import { useEffect, useRef, type RefObject } from "react";
import { TRACK_COORDS } from "./rules";
import { travelAlong } from "../../ui/motion";

/**
 * Walks Ludo pawns around the track.
 *
 * A pawn that moves six squares should be seen to move six squares. Sliding it
 * straight from A to B would cut diagonally across the middle of the board,
 * through squares it never visited — which looks wrong precisely because the
 * track is the whole game. So the animation follows the actual route, one
 * square at a time, and you can count the hops just as you would with a real
 * board.
 *
 * React has already painted the pawn at its destination by the time this runs,
 * so every offset is expressed relative to where it now sits and the animation
 * ends at zero.
 */

export interface PawnPosition {
  /** Stable per pawn: owner id and index. */
  key: string;
  /** Absolute track square, or null in base / the home column. */
  square: number | null;
}

export function useTokenTravel(
  board: RefObject<HTMLElement | null>,
  pawns: PawnPosition[],
  msPerStep = 120
): void {
  const previous = useRef(new Map<string, number | null>());

  useEffect(() => {
    const boardEl = board.current;
    if (!boardEl) {
      previous.current = new Map(pawns.map((p) => [p.key, p.square]));
      return;
    }

    // The board is a 15×15 grid, so one square is a fifteenth of its width.
    const cell = boardEl.getBoundingClientRect().width / 15;

    for (const pawn of pawns) {
      const before = previous.current.get(pawn.key);
      const after = pawn.square;
      // Only track-to-track movement has a route to follow. Leaving base or
      // entering the home column is a single step, and FLIP covers it.
      if (before == null || after == null || before === after) continue;

      const route = squaresBetween(before, after);
      if (route.length === 0 || route.length > 12) continue;

      const node = boardEl.querySelector<HTMLElement>(`[data-flip="${CSS.escape(pawn.key)}"]`);
      const end = TRACK_COORDS[after];
      if (!node || !end) continue;

      // Offsets from the destination back along the route, in pixels.
      const offsets = route.map((square) => {
        const coord = TRACK_COORDS[square]!;
        return { x: (coord[0] - end[0]) * cell, y: (coord[1] - end[1]) * cell };
      });
      travelAlong(node, [...offsets, { x: 0, y: 0 }], msPerStep);
    }

    previous.current = new Map(pawns.map((p) => [p.key, p.square]));
  }, [board, pawns, msPerStep]);
}

/**
 * The squares actually travelled, starting where the pawn was.
 *
 * The track wraps at 52, so a move from 50 to 2 passes through 51 and 0 rather
 * than running backwards around the board.
 */
export function squaresBetween(from: number, to: number, trackLength = TRACK_COORDS.length): number[] {
  const steps = (to - from + trackLength) % trackLength;
  // A capture sends a pawn home; that is not a walk, it is a removal.
  if (steps === 0 || steps > 12) return [];
  return Array.from({ length: steps }, (_, i) => (from + i) % trackLength);
}
