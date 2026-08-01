import { describe, it, expect } from "vitest";
import { createDash, HIT_BAND, LANES, moveLane, PLAYER_Y, step } from "./engine";

/** Runs the world forward in realistic frames. */
function run(seed: number, seconds: number, drive?: (s: ReturnType<typeof createDash>) => -1 | 1 | 0) {
  let state = createDash(seed);
  const frame = 1 / 60;
  for (let t = 0; t < seconds * 60 && !state.crashed; t++) {
    const turn = drive?.(state) ?? 0;
    if (turn !== 0) state = moveLane(state, turn);
    state = step(state, frame);
  }
  return state;
}

describe("steering", () => {
  it("moves between lanes", () => {
    const state = createDash(1);
    expect(moveLane(state, 1).lane).toBe(state.lane + 1);
    expect(moveLane(state, -1).lane).toBe(state.lane - 1);
  });

  it("cannot leave the road", () => {
    let state = createDash(1);
    for (let i = 0; i < 10; i++) state = moveLane(state, -1);
    expect(state.lane).toBe(0);
    for (let i = 0; i < 10; i++) state = moveLane(state, 1);
    expect(state.lane).toBe(LANES - 1);
  });

  it("ignores steering after a crash", () => {
    const crashed = { ...createDash(1), crashed: true };
    expect(moveLane(crashed, 1)).toBe(crashed);
  });
});

describe("the world", () => {
  it("moves obstacles toward the player and clears the ones that pass", () => {
    let state = createDash(7);
    state = run(7, 3);
    expect(state.obstacles.every((o) => o.y < 1.15)).toBe(true);
  });

  it("gets harder: speed climbs and never runs away", () => {
    const early = run(3, 2);
    const later = run(3, 20);
    expect(later.speed).toBeGreaterThan(early.speed);
    expect(later.speed).toBeLessThanOrEqual(1.9);
  });

  it("counts distance while running", () => {
    expect(run(5, 3).distance).toBeGreaterThan(0);
  });

  /**
   * A backgrounded tab hands back an enormous delta on return. Without a cap
   * the world jumps forward far enough to teleport a car through the player,
   * and you lose a run to a collision you never saw.
   */
  it("does not teleport obstacles through the player after a long pause", () => {
    let state = createDash(11);
    for (let i = 0; i < 120; i++) state = step(state, 1 / 60);
    const before = state.obstacles.map((o) => o.y);
    const jumped = step(state, 5);
    const moved = Math.max(...jumped.obstacles.map((o, i) => o.y - (before[i] ?? o.y)));
    expect(moved).toBeLessThan(HIT_BAND * 2);
  });

  it("ends the run when something is in your lane", () => {
    let state = createDash(2);
    state = { ...state, obstacles: [{ lane: state.lane, y: PLAYER_Y, kind: "car" }] };
    expect(step(state, 1 / 60).crashed).toBe(true);
  });

  it("does not end the run for a lane you are not in", () => {
    let state = createDash(2);
    const other = (state.lane + 1) % LANES;
    state = { ...state, obstacles: [{ lane: other, y: PLAYER_Y, kind: "car" }] };
    expect(step(state, 1 / 60).crashed).toBe(false);
  });

  it("freezes once crashed", () => {
    const crashed = { ...createDash(1), crashed: true, distance: 100 };
    expect(step(crashed, 1 / 60)).toBe(crashed);
  });

  /**
   * The game has to stay winnable: if every lane can fill at once, surviving
   * stops being about reactions and becomes a coin toss.
   */
  it("always leaves a way through", () => {
    // A wall is obstacles arriving TOGETHER. Ones far apart down the road are
    // passable however they are arranged, because there is time to move
    // between them — so the check is per cluster, not per screen.
    const CLUSTER = 0.12;
    for (let seed = 1; seed <= 25; seed++) {
      let state = createDash(seed);
      for (let t = 0; t < 60 * 30; t++) {
        state = step(state, 1 / 60);
        for (const o of state.obstacles) {
          const together = state.obstacles.filter((other) => Math.abs(other.y - o.y) <= CLUSTER);
          const lanesBlocked = new Set(together.map((x) => x.lane));
          expect(lanesBlocked.size, `seed ${seed} sealed the road at y=${o.y.toFixed(2)}`).toBeLessThan(
            LANES
          );
        }
        if (state.crashed) break;
      }
    }
  });

  it("is reproducible from a seed", () => {
    expect(run(42, 5).distance).toBe(run(42, 5).distance);
    expect(run(42, 5).obstacles.length).toBe(run(42, 5).obstacles.length);
  });

  it("differs between seeds", () => {
    const a = run(1, 6).obstacles.map((o) => o.lane).join();
    const b = run(2, 6).obstacles.map((o) => o.lane).join();
    expect(a).not.toBe(b);
  });
});
