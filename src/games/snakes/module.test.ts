import { describe, it, expect } from "vitest";
import { snakesModule as game, type SnakesState } from "./module";
import {
  BOARD_SIZE,
  CLASSIC_BOARD,
  CRUEL_BOARD,
  destinationOf,
  getSnakesVariant,
  SHORT_BOARD,
  SNAKES_VARIANTS,
  validateBoard,
} from "./rules";
import { rollDie } from "../../engine/rng";

const PLAYERS = ["ana", "ben", "cleo"];

function fresh(players = PLAYERS, seed = 1, variant = "classic"): SnakesState {
  return game.createInitialState(players, { seed, variant });
}

function playMatch(seed: number, variant = "classic", players = PLAYERS) {
  let state = fresh(players, seed, variant);
  let moves = 0;
  while (game.checkWinCondition(state) === null) {
    if (moves++ > 20000) throw new Error(`seed ${seed} (${variant}) did not terminate`);
    const actor = game.getCurrentPlayerId(state)!;
    const move = game.getTimeoutMove!(state, actor)!;
    expect(game.validateMove(state, actor, move)).toBe(true);
    state = game.applyMove(state, actor, move).state;
  }
  return { state, moves };
}

describe("board definitions", () => {
  it.each(SNAKES_VARIANTS.map((v) => v.id))("%s is a well-formed board", (id) => {
    const rules = getSnakesVariant(id);
    // Ladders must go up, snakes must go down, and nothing may chain or
    // overlap — a board that fails this is nonsense, not merely different.
    expect(validateBoard(rules)).toEqual([]);
  });

  it("catches a ladder that goes down", () => {
    const broken = { ...CLASSIC_BOARD, ladders: { 40: 20 }, snakes: {} };
    expect(validateBoard(broken)).toContain("ladder 40→20 does not go up");
  });

  it("catches a snake that goes up", () => {
    const broken = { ...CLASSIC_BOARD, ladders: {}, snakes: { 20: 40 } };
    expect(validateBoard(broken)).toContain("snake 20→40 does not go down");
  });

  it("catches a square that is both a snake and a ladder", () => {
    const broken = { ...CLASSIC_BOARD, ladders: { 30: 60 }, snakes: { 30: 10 } };
    expect(validateBoard(broken).some((p) => /both a ladder and a snake/.test(p))).toBe(true);
  });

  it("resolves a square to its destination", () => {
    expect(destinationOf(1, CLASSIC_BOARD)).toBe(38);
    expect(destinationOf(16, CLASSIC_BOARD)).toBe(6);
    expect(destinationOf(50, CLASSIC_BOARD)).toBeNull();
  });

  it("ships boards that genuinely differ", () => {
    expect(CLASSIC_BOARD.requireExactFinish).toBe(true);
    expect(SHORT_BOARD.requireExactFinish).toBe(false);
    expect(CRUEL_BOARD.extraTurnRoll).toBeNull();
  });
});

describe("dice are server-authoritative", () => {
  it("takes no number from the client", () => {
    const state = fresh();
    // The only move shape is {type:"roll"} — there is nothing to forge.
    expect(game.validateMove(state, "ana", { type: "roll" })).toBe(true);
    expect(game.validateMove(state, "ana", { type: "roll", value: 6 } as never)).toBe(true);
    const { state: after } = game.applyMove(state, "ana", { type: "roll", value: 6 } as never);
    // A supplied "6" is ignored; the server rolls its own.
    expect(after.lastRoll).toBeGreaterThanOrEqual(1);
    expect(after.lastRoll).toBeLessThanOrEqual(6);
  });

  it("is deterministic from the seed", () => {
    const a = game.applyMove(fresh(PLAYERS, 55), "ana", { type: "roll" }).state;
    const b = game.applyMove(fresh(PLAYERS, 55), "ana", { type: "roll" }).state;
    expect(a.lastRoll).toBe(b.lastRoll);
    expect(a.players[0]!.square).toBe(b.players[0]!.square);
  });

  it("publishes the roll to every viewer", () => {
    const state = game.applyMove(fresh(), "ana", { type: "roll" }).state;
    for (const viewer of [...PLAYERS, null]) {
      expect(game.getPlayerView(state, viewer).lastRoll).toBe(state.lastRoll);
    }
  });

  it("spreads evenly across the six faces", () => {
    const counts = new Map<number, number>();
    let rng = 4242;
    for (let i = 0; i < 6000; i++) {
      const { value, state } = rollDie(rng);
      rng = state;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const face of [1, 2, 3, 4, 5, 6]) {
      expect(counts.get(face)!).toBeGreaterThan(850);
      expect(counts.get(face)!).toBeLessThan(1150);
    }
  });

  it("bumps rollCount so the client can animate each roll", () => {
    const state = fresh();
    const after = game.applyMove(state, "ana", { type: "roll" }).state;
    expect(after.rollCount).toBe(state.rollCount + 1);
  });
});

describe("movement", () => {
  it("moves a token by the roll", () => {
    const state = fresh(["p1", "p2"], 3);
    state.players[0]!.square = 50; // an ordinary square
    const { state: after } = game.applyMove(state, "p1", { type: "roll" });
    const roll = after.lastRoll!;
    const expected = destinationOf(50 + roll, after.rules) ?? 50 + roll;
    expect(after.players[0]!.square).toBe(expected);
  });

  it("climbs a ladder", () => {
    const state = fresh(["p1", "p2"]);
    // Square 3 + 1 = 4, which is a ladder base to 14 on the classic board.
    state.players[0]!.square = 3;
    state.dice = null;
    let attempts = 0;
    let result = state;
    // Roll until we get the 1 we need, reseeding each time.
    while (attempts < 200) {
      const trial = fresh(["p1", "p2"], attempts + 1);
      trial.players[0]!.square = 3;
      const applied = game.applyMove(trial, "p1", { type: "roll" }).state;
      if (applied.lastRoll === 1) {
        result = applied;
        break;
      }
      attempts++;
    }
    expect(result.players[0]!.square).toBe(CLASSIC_BOARD.ladders[4]);
    expect(result.lastMove!.kind).toBe("ladder");
  });

  it("slides down a snake", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const state = fresh(["p1", "p2"], seed);
      state.players[0]!.square = 15; // 15 + 1 = 16, a snake head to 6
      const after = game.applyMove(state, "p1", { type: "roll" }).state;
      if (after.lastRoll === 1) {
        expect(after.players[0]!.square).toBe(CLASSIC_BOARD.snakes[16]);
        expect(after.lastMove!.kind).toBe("snake");
        return;
      }
    }
    throw new Error("never rolled a 1 across 200 seeds");
  });

  it("records the intermediate square so the client can animate the slide", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const state = fresh(["p1", "p2"], seed);
      state.players[0]!.square = 15;
      const after = game.applyMove(state, "p1", { type: "roll" }).state;
      if (after.lastRoll === 1) {
        expect(after.lastMove).toMatchObject({ from: 15, steppedTo: 16, finalSquare: 6, kind: "snake" });
        return;
      }
    }
  });
});

describe("finishing", () => {
  it("requires an exact roll on the classic board", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const state = fresh(["p1", "p2"], seed, "classic");
      state.players[0]!.square = 98;
      const after = game.applyMove(state, "p1", { type: "roll" }).state;
      if (after.lastRoll! > 2) {
        // Overshooting leaves the token where it was.
        expect(after.players[0]!.square).toBe(98);
        expect(after.lastMove!.kind).toBe("blocked");
        expect(after.finished).toBe(false);
        return;
      }
    }
    throw new Error("never rolled above 2");
  });

  it("lets an overshoot finish on a board that allows it", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const state = fresh(["p1", "p2"], seed, "short");
      state.players[0]!.square = 98;
      const after = game.applyMove(state, "p1", { type: "roll" }).state;
      if (after.lastRoll! > 2) {
        expect(after.players[0]!.square).toBe(BOARD_SIZE);
        expect(after.finished).toBe(true);
        expect(after.winners).toEqual(["p1"]);
        return;
      }
    }
    throw new Error("never rolled above 2");
  });

  it("wins on landing exactly on 100", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const state = fresh(["p1", "p2"], seed, "classic");
      state.players[0]!.square = 99;
      const after = game.applyMove(state, "p1", { type: "roll" }).state;
      if (after.lastRoll === 1) {
        expect(after.players[0]!.square).toBe(100);
        expect(game.checkWinCondition(after)).toEqual({ finished: true, winners: ["p1"] });
        return;
      }
    }
    throw new Error("never rolled a 1");
  });
});

describe("full matches", () => {
  it.each(SNAKES_VARIANTS.map((v) => v.id))("terminates with one winner (%s)", (variant) => {
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = playMatch(seed, variant);
      const win = game.checkWinCondition(state)!;
      expect(win.finished).toBe(true);
      expect(win.winners).toHaveLength(1);
      expect(state.players.find((p) => p.id === win.winners[0])!.square).toBe(BOARD_SIZE);
    }
  });

  it("keeps every token on the board at all times", () => {
    let state = fresh(PLAYERS, 12);
    let guard = 0;
    while (game.checkWinCondition(state) === null && guard++ < 5000) {
      for (const p of state.players) {
        expect(p.square).toBeGreaterThanOrEqual(0);
        expect(p.square).toBeLessThanOrEqual(BOARD_SIZE);
      }
      const actor = game.getCurrentPlayerId(state)!;
      state = game.applyMove(state, actor, { type: "roll" }).state;
    }
  });

  it("plays two-handed and four-handed", () => {
    expect(game.checkWinCondition(playMatch(5, "classic", ["a", "b"]).state)!.winners).toHaveLength(1);
    expect(
      game.checkWinCondition(playMatch(6, "classic", ["a", "b", "c", "d"]).state)!.winners
    ).toHaveLength(1);
  });

  it("stops handing out turns once finished", () => {
    const { state } = playMatch(7);
    expect(game.getCurrentPlayerId(state)).toBeNull();
  });
});

describe("public information", () => {
  it("declares itself an open-information game", () => {
    expect(game.meta.hasHiddenState).toBe(false);
  });

  it("gives every viewer an identical board", () => {
    const state = game.applyMove(fresh(PLAYERS, 31), "ana", { type: "roll" }).state;
    const boards = [...PLAYERS, null].map((v) =>
      JSON.stringify(game.getPlayerView(state, v).players)
    );
    expect(new Set(boards).size).toBe(1);
  });

  it("publishes the board layout so the client can draw it", () => {
    const view = game.getPlayerView(fresh(), "ana");
    expect(view.ladders).toEqual(CLASSIC_BOARD.ladders);
    expect(view.snakes).toEqual(CLASSIC_BOARD.snakes);
    expect(view.boardSize).toBe(100);
  });

  it("only lights up the controls for the player to act", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    expect(game.getPlayerView(state, actor).mustRoll).toBe(true);
    for (const other of PLAYERS.filter((p) => p !== actor)) {
      expect(game.getPlayerView(state, other).mustRoll).toBe(false);
    }
  });
});

describe("validation", () => {
  it("rejects a roll from the wrong player", () => {
    const state = fresh();
    expect(game.validateMove(state, "ben", { type: "roll" })).toBe(false);
  });

  it("rejects malformed moves without throwing", () => {
    const state = fresh();
    for (const junk of [null, undefined, {}, 6, "roll", { type: "move" }]) {
      expect(() => game.validateMove(state, "ana", junk as never)).not.toThrow();
      expect(game.validateMove(state, "ana", junk as never)).toBe(false);
    }
  });

  it("does not mutate the state it is given", () => {
    const state = fresh();
    const before = JSON.stringify(state);
    game.applyMove(state, "ana", { type: "roll" });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("refuses to apply a move it would not validate", () => {
    const state = fresh();
    expect(() => game.applyMove(state, "ben", { type: "roll" })).toThrow();
  });
});
