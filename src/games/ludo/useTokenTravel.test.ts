import { describe, it, expect } from "vitest";
import { squaresBetween } from "./useTokenTravel";
import { TRACK_COORDS } from "./rules";

/**
 * The route a pawn walks.
 *
 * Sliding straight from A to B would cut across the middle of the board
 * through squares the pawn never visited, which is exactly the part of the
 * board the track is drawn around. This is the logic that keeps it honest.
 */
describe("route around the track", () => {
  it("lists every square passed through, starting where the pawn was", () => {
    expect(squaresBetween(10, 14)).toEqual([10, 11, 12, 13]);
  });

  it("wraps the end of the track instead of running backwards", () => {
    // 50 → 2 is four steps forwards, not forty-eight back.
    expect(squaresBetween(50, 2, 52)).toEqual([50, 51, 0, 1]);
  });

  it("walks a single square", () => {
    expect(squaresBetween(7, 8)).toEqual([7]);
  });

  it("never walks further than a die can send you", () => {
    // A pawn appearing far away was sent home by a capture, not walked there;
    // animating that as a stroll around the board would misrepresent it.
    expect(squaresBetween(0, 30)).toEqual([]);
    expect(squaresBetween(0, 0)).toEqual([]);
  });

  it("stays within the coordinate table for every step", () => {
    for (let from = 0; from < TRACK_COORDS.length; from++) {
      for (let roll = 1; roll <= 6; roll++) {
        const to = (from + roll) % TRACK_COORDS.length;
        const route = squaresBetween(from, to);
        expect(route).toHaveLength(roll);
        for (const square of route) expect(TRACK_COORDS[square]).toBeDefined();
      }
    }
  });
});
