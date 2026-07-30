import { describe, it, expect } from "vitest";
import { DICE_SPACING, DIE_REST_Y, jitter, layoutDice, SEAT_RADIUS, TABLE_RADIUS } from "./layout";
import type { DieView } from "../animation/types";

function hand(ownerId: string, count: number): DieView[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${ownerId}-${i}`,
    ownerId,
    face: null,
  }));
}

function table(owners: number, dicePer = 5): DieView[] {
  return Array.from({ length: owners }, (_, i) => hand(`p${i}`, dicePer)).flat();
}

describe("jitter", () => {
  it("stays within [-1, 1]", () => {
    for (let i = 0; i < 200; i++) {
      const v = jitter(`die-${i}`, 1);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic — the same die never drifts between renders", () => {
    expect(jitter("p1-3", 1)).toBe(jitter("p1-3", 1));
  });

  it("gives different offsets to different dice and different axes", () => {
    expect(jitter("p1-3", 1)).not.toBe(jitter("p1-4", 1));
    expect(jitter("p1-3", 1)).not.toBe(jitter("p1-3", 2));
  });

  it("spreads roughly evenly rather than clustering", () => {
    const values = Array.from({ length: 400 }, (_, i) => jitter(`d${i}`, 1));
    const negatives = values.filter((v) => v < 0).length;
    expect(negatives).toBeGreaterThan(120);
    expect(negatives).toBeLessThan(280);
  });
});

describe("layoutDice", () => {
  it("places every die exactly once", () => {
    const dice = table(4);
    const placed = layoutDice(dice);
    expect(placed).toHaveLength(dice.length);
    expect(new Set(placed.map((p) => p.id)).size).toBe(dice.length);
  });

  it("rests every die on the felt, never sunk in or floating", () => {
    for (const die of layoutDice(table(4))) {
      expect(die.position[1]).toBe(DIE_REST_Y);
    }
  });

  it("keeps all dice on the table surface", () => {
    for (const owners of [2, 3, 4, 5, 6]) {
      for (const die of layoutDice(table(owners))) {
        const radius = Math.hypot(die.position[0], die.position[2]);
        expect(radius).toBeLessThan(TABLE_RADIUS);
      }
    }
  });

  it("scatters dice instead of laying them in a perfect line", () => {
    const placed = layoutDice(hand("p0", 5));
    const gaps: number[] = [];
    for (let i = 1; i < placed.length; i++) {
      const a = placed[i - 1]!.position;
      const b = placed[i]!.position;
      gaps.push(Math.hypot(b[0] - a[0], b[2] - a[2]));
    }
    // A rigid grid would give identical gaps; a thrown hand must not.
    expect(new Set(gaps.map((g) => g.toFixed(4))).size).toBeGreaterThan(1);
  });

  it("never overlaps two dice", () => {
    const placed = layoutDice(table(4));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!.position;
        const b = placed[j]!.position;
        const gap = Math.hypot(a[0] - b[0], a[2] - b[2]);
        // Dice are 0.9 wide; require a visible sliver between them.
        expect(gap).toBeGreaterThan(0.5);
      }
    }
  });

  it("seats each player around the table rather than piling them together", () => {
    const placed = layoutDice(table(4));
    const centres = new Map<string, [number, number]>();
    for (const owner of ["p0", "p1", "p2", "p3"]) {
      const own = placed.filter((p) => p.id.startsWith(owner + "-"));
      const cx = own.reduce((s, p) => s + p.position[0], 0) / own.length;
      const cz = own.reduce((s, p) => s + p.position[2], 0) / own.length;
      centres.set(owner, [cx, cz]);
    }
    const list = [...centres.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const gap = Math.hypot(list[i]![0] - list[j]![0], list[i]![1] - list[j]![1]);
        expect(gap).toBeGreaterThan(SEAT_RADIUS * 0.8);
      }
    }
  });

  it("spreads a hand along the table edge, not toward the camera", () => {
    // Seat 0 sits at +Z facing the camera; its row must run across X (screen
    // horizontal). A row running along Z would project as a vertical stack.
    const placed = layoutDice(hand("p0", 5));
    const spreadX = Math.max(...placed.map((p) => p.position[0])) - Math.min(...placed.map((p) => p.position[0]));
    const spreadZ = Math.max(...placed.map((p) => p.position[2])) - Math.min(...placed.map((p) => p.position[2]));
    expect(spreadX).toBeGreaterThan(spreadZ * 2);
    expect(spreadX).toBeGreaterThan(DICE_SPACING * 3);
  });

  it("handles a single remaining die (palifico endgame) without error", () => {
    const placed = layoutDice([...hand("p0", 1), ...hand("p1", 1)]);
    expect(placed).toHaveLength(2);
    expect(Math.hypot(placed[0]!.position[0] - placed[1]!.position[0], placed[0]!.position[2] - placed[1]!.position[2]))
      .toBeGreaterThan(1);
  });
});
