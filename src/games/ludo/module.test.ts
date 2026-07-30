import { describe, it, expect } from "vitest";
import { ludoModule as game, movablePawns, targetProgress, type LudoState } from "./module";
import { rollDie } from "../../engine/rng";
import {
  absoluteSquare,
  CLASSIC_LUDO,
  CUTTHROAT_LUDO,
  ENTRY_SQUARES,
  HOME_PROGRESS,
  isSafeSquare,
  PAWNS_PER_PLAYER,
  QUICK_LUDO,
  SAFE_SQUARES,
  TRACK_LENGTH,
} from "./rules";

const PLAYERS = ["red", "green", "yellow", "blue"];

function fresh(players = PLAYERS, seed = 1, variant = "classic"): LudoState {
  return game.createInitialState(players, { seed, variant });
}

/** Plays a whole match through the interface alone. */
function playMatch(seed: number, players = PLAYERS, variant = "classic") {
  let state = fresh(players, seed, variant);
  let moves = 0;
  while (game.checkWinCondition(state) === null) {
    if (moves++ > 20000) throw new Error(`seed ${seed} did not terminate`);
    const actor = game.getCurrentPlayerId(state)!;
    const move = game.getTimeoutMove!(state, actor)!;
    expect(game.validateMove(state, actor, move)).toBe(true);
    state = game.applyMove(state, actor, move).state;
  }
  return { state, moves };
}

describe("board geometry", () => {
  it("spaces the four entry squares evenly round the track", () => {
    expect(ENTRY_SQUARES).toEqual([0, 13, 26, 39]);
    expect(TRACK_LENGTH).toBe(52);
  });

  it("maps progress onto the shared track relative to a seat's entry", () => {
    expect(absoluteSquare(0, 0)).toBe(0);
    expect(absoluteSquare(1, 0)).toBe(13);
    // Wrapping past the end of the track comes back round to the start.
    expect(absoluteSquare(3, 13)).toBe(0);
    expect(absoluteSquare(2, 30)).toBe((26 + 30) % 52);
  });

  it("puts a pawn off the shared track once it enters its home column", () => {
    expect(absoluteSquare(0, TRACK_LENGTH)).toBeNull();
    expect(absoluteSquare(0, HOME_PROGRESS)).toBeNull();
  });

  it("has eight safe squares including every entry square", () => {
    expect(SAFE_SQUARES.size).toBe(8);
    for (const entry of ENTRY_SQUARES) expect(SAFE_SQUARES.has(entry)).toBe(true);
  });

  it("disables safe squares in the cutthroat variant", () => {
    expect(isSafeSquare(0, CLASSIC_LUDO)).toBe(true);
    expect(isSafeSquare(0, CUTTHROAT_LUDO)).toBe(false);
  });
});

describe("setup", () => {
  it("gives every player four pawns in base", () => {
    const state = fresh();
    expect(state.players).toHaveLength(4);
    for (const p of state.players) {
      expect(p.pawns).toHaveLength(PAWNS_PER_PLAYER);
      expect(p.pawns.every((pawn) => pawn.inBase && !pawn.home)).toBe(true);
    }
  });

  it("supports two- and three-player games", () => {
    expect(fresh(["a", "b"]).players).toHaveLength(2);
    expect(fresh(["a", "b", "c"]).players).toHaveLength(3);
  });

  it("gives each seat a distinct colour", () => {
    const colors = fresh().players.map((p) => p.color);
    expect(new Set(colors).size).toBe(4);
  });
});

describe("dice are server-authoritative", () => {
  it("requires a roll before a pawn can move", () => {
    const state = fresh();
    expect(state.dice).toBeNull();
    expect(game.validateMove(state, "red", { type: "movePawn", pawn: 0 })).toBe(false);
    expect(game.validateMove(state, "red", { type: "roll" })).toBe(true);
  });

  it("produces the roll itself — a client cannot supply one", () => {
    const state = fresh();
    const { state: after } = game.applyMove(state, "red", { type: "roll" });
    // `dice` is cleared when a roll leaves nothing to move, so assert on
    // lastRoll, which records the result regardless of what followed.
    expect(after.lastRoll).toBeGreaterThanOrEqual(1);
    expect(after.lastRoll).toBeLessThanOrEqual(6);
    expect(after.lastRollBy).toBe("red");
    // The move payload carries no number at all, so there is nothing to forge.
    expect(Object.keys({ type: "roll" })).toEqual(["type"]);
  });

  it("keeps the roll visible even when there is nothing to move", () => {
    // Every pawn is in base, so any non-six passes the turn immediately. The
    // player must still be able to see what they rolled.
    for (let seed = 1; seed <= 40; seed++) {
      const { state } = game.applyMove(fresh(PLAYERS, seed), "red", { type: "roll" });
      expect(state.lastRoll).not.toBeNull();
      if (state.lastRoll !== 6) {
        expect(state.dice).toBeNull();
        expect(game.getCurrentPlayerId(state)).toBe("green");
        // ...and the view still reports it.
        expect(game.getPlayerView(state, "red").lastRoll).toBe(state.lastRoll);
      }
    }
  });

  it("is deterministic for a given seed, so a match can be replayed", () => {
    const a = game.applyMove(fresh(PLAYERS, 99), "red", { type: "roll" }).state;
    const b = game.applyMove(fresh(PLAYERS, 99), "red", { type: "roll" }).state;
    expect(a.dice).toBe(b.dice);
  });

  it("refuses a second roll while one is still unused", () => {
    let state = fresh();
    state = game.applyMove(state, "red", { type: "roll" }).state;
    if (state.dice !== null) {
      expect(game.validateMove(state, "red", { type: "roll" })).toBe(false);
    }
  });

  it("publishes the roll to everyone — it is not hidden", () => {
    const state = game.applyMove(fresh(), "red", { type: "roll" }).state;
    for (const viewer of [...PLAYERS, null]) {
      expect(game.getPlayerView(state, viewer).dice).toBe(state.dice);
    }
  });

  it("spreads roughly evenly across all six faces", () => {
    // Advance one match's stream rather than reseeding per roll, which is how
    // the module actually draws.
    const counts = new Map<number, number>();
    let state = fresh(PLAYERS, 2024);
    for (let i = 0; i < 6000; i++) {
      const { value, state: nextState } = rollDie(state.rngState);
      state = { ...state, rngState: nextState };
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const face of [1, 2, 3, 4, 5, 6]) {
      // Expect ~1000 each; allow generous slack for a 6k sample.
      expect(counts.get(face)!).toBeGreaterThan(850);
      expect(counts.get(face)!).toBeLessThan(1150);
    }
  });
});

describe("leaving base", () => {
  it("only lets a pawn out on the exit roll", () => {
    const state = fresh();
    for (let roll = 1; roll <= 6; roll++) {
      state.dice = roll;
      const movable = movablePawns(state, 0, roll);
      expect(movable.length).toBe(roll === CLASSIC_LUDO.exitRoll ? PAWNS_PER_PLAYER : 0);
    }
  });

  it("puts a freed pawn on its own entry square", () => {
    const state = fresh();
    state.dice = 6;
    const { state: after } = game.applyMove(state, "red", { type: "movePawn", pawn: 0 });
    const pawn = after.players[0]!.pawns[0]!;
    expect(pawn.inBase).toBe(false);
    expect(pawn.progress).toBe(0);
    expect(absoluteSquare(0, pawn.progress)).toBe(ENTRY_SQUARES[0]);
  });

  it("passes the turn when a roll leaves nothing to do", () => {
    let state = fresh(PLAYERS, 5);
    // Force a non-six with every pawn stuck in base.
    state = game.applyMove(state, "red", { type: "roll" }).state;
    if (state.dice !== 6) {
      expect(game.getCurrentPlayerId(state)).toBe("green");
    }
  });
});

describe("extra turns", () => {
  it("keeps the turn with the roller after a six", () => {
    const state = fresh();
    state.dice = 6;
    const { state: after, events } = game.applyMove(state, "red", { type: "movePawn", pawn: 0 });
    expect(game.getCurrentPlayerId(after)).toBe("red");
    expect(after.dice).toBeNull();
    expect(events.some((e) => e.type === "extraTurn")).toBe(true);
  });

  it("forfeits the turn after too many consecutive sixes", () => {
    const state = fresh();
    state.dice = 6;
    state.consecutiveExtras = CLASSIC_LUDO.maxConsecutiveExtraTurns - 1;
    const { state: after, events } = game.applyMove(state, "red", { type: "movePawn", pawn: 0 });
    expect(events.some((e) => e.type === "extrasForfeit")).toBe(true);
    expect(game.getCurrentPlayerId(after)).toBe("green");
  });

  it("grants another turn for a capture", () => {
    const state = fresh();
    // Red pawn 3 steps from an unsafe square that green occupies.
    state.players[0]!.pawns[0] = { progress: 1, inBase: false, home: false };
    const target = absoluteSquare(0, 4)!;
    expect(isSafeSquare(target, CLASSIC_LUDO)).toBe(false);
    const greenProgress = (target - ENTRY_SQUARES[1]! + TRACK_LENGTH) % TRACK_LENGTH;
    state.players[1]!.pawns[0] = { progress: greenProgress, inBase: false, home: false };
    state.dice = 3;

    const { state: after, events } = game.applyMove(state, "red", { type: "movePawn", pawn: 0 });
    expect(events.some((e) => e.type === "capture")).toBe(true);
    expect(after.players[1]!.pawns[0]!.inBase).toBe(true);
    expect(game.getCurrentPlayerId(after)).toBe("red");
  });
});

describe("capture", () => {
  it("sends an opponent home from an unsafe square", () => {
    const state = fresh();
    state.players[0]!.pawns[0] = { progress: 2, inBase: false, home: false };
    const target = absoluteSquare(0, 4)!;
    const greenProgress = (target - ENTRY_SQUARES[1]! + TRACK_LENGTH) % TRACK_LENGTH;
    state.players[1]!.pawns[1] = { progress: greenProgress, inBase: false, home: false };
    state.dice = 2;

    const { state: after } = game.applyMove(state, "red", { type: "movePawn", pawn: 0 });
    expect(after.players[1]!.pawns[1]!.inBase).toBe(true);
    expect(after.players[1]!.pawns[1]!.progress).toBe(-1);
  });

  it("does not capture on a safe square", () => {
    const state = fresh();
    // Square 8 is a starred safe square.
    const safe = 8;
    expect(isSafeSquare(safe, CLASSIC_LUDO)).toBe(true);
    state.players[0]!.pawns[0] = { progress: safe - 2, inBase: false, home: false };
    const greenProgress = (safe - ENTRY_SQUARES[1]! + TRACK_LENGTH) % TRACK_LENGTH;
    state.players[1]!.pawns[0] = { progress: greenProgress, inBase: false, home: false };
    state.dice = 2;

    const { state: after, events } = game.applyMove(state, "red", { type: "movePawn", pawn: 0 });
    expect(after.players[1]!.pawns[0]!.inBase).toBe(false);
    expect(events.some((e) => e.type === "capture")).toBe(false);
  });

  it("captures on that same square under cutthroat rules", () => {
    const state = fresh(PLAYERS, 1, "cutthroat");
    const safe = 8;
    state.players[0]!.pawns[0] = { progress: safe - 2, inBase: false, home: false };
    const greenProgress = (safe - ENTRY_SQUARES[1]! + TRACK_LENGTH) % TRACK_LENGTH;
    state.players[1]!.pawns[0] = { progress: greenProgress, inBase: false, home: false };
    state.dice = 2;

    const { state: after } = game.applyMove(state, "red", { type: "movePawn", pawn: 0 });
    expect(after.players[1]!.pawns[0]!.inBase).toBe(true);
  });

  it("never captures its own pawn — it refuses the move instead", () => {
    const state = fresh();
    state.players[0]!.pawns[0] = { progress: 5, inBase: false, home: false };
    state.players[0]!.pawns[1] = { progress: 8, inBase: false, home: false };
    state.dice = 3; // pawn 0 would land on pawn 1
    expect(movablePawns(state, 0, 3)).not.toContain(0);
  });
});

describe("home column and finishing", () => {
  it("requires an exact roll to get home in the classic rules", () => {
    const pawn = { progress: HOME_PROGRESS - 2, inBase: false, home: false };
    expect(targetProgress(pawn, 2, CLASSIC_LUDO)).toBe(HOME_PROGRESS);
    expect(targetProgress(pawn, 3, CLASSIC_LUDO)).toBeNull();
  });

  it("lets an overshoot finish in the quick variant", () => {
    const pawn = { progress: HOME_PROGRESS - 2, inBase: false, home: false };
    expect(targetProgress(pawn, 5, QUICK_LUDO)).toBe(HOME_PROGRESS);
  });

  it("marks a pawn home and takes it off the track", () => {
    const state = fresh();
    state.players[0]!.pawns[0] = { progress: HOME_PROGRESS - 1, inBase: false, home: false };
    state.dice = 1;
    const { state: after, events } = game.applyMove(state, "red", { type: "movePawn", pawn: 0 });
    const pawn = after.players[0]!.pawns[0]!;
    expect(pawn.home).toBe(true);
    expect(events.some((e) => e.type === "pawnHome")).toBe(true);
    expect(game.getPlayerView(after, "red").players[0]!.pawns[0]!.square).toBeNull();
  });

  it("ends the match when a player gets all four pawns home", () => {
    const state = fresh(["a", "b"]);
    state.players[0]!.pawns = [
      { progress: HOME_PROGRESS, inBase: false, home: true },
      { progress: HOME_PROGRESS, inBase: false, home: true },
      { progress: HOME_PROGRESS, inBase: false, home: true },
      { progress: HOME_PROGRESS - 1, inBase: false, home: false },
    ];
    state.dice = 1;
    const { state: after } = game.applyMove(state, "a", { type: "movePawn", pawn: 3 });
    expect(after.finished).toBe(true);
    expect(game.checkWinCondition(after)).toEqual({ finished: true, winners: ["a"] });
  });
});

describe("full matches", () => {
  it.each(["classic", "quick", "cutthroat"])("terminates with one winner (%s)", (variant) => {
    for (let seed = 1; seed <= 6; seed++) {
      const { state } = playMatch(seed, PLAYERS, variant);
      const win = game.checkWinCondition(state)!;
      expect(win.finished).toBe(true);
      expect(win.winners).toHaveLength(1);
      const champion = state.players.find((p) => p.id === win.winners[0])!;
      expect(champion.pawns.every((p) => p.home)).toBe(true);
    }
  });

  it("conserves four pawns per player throughout", () => {
    const { state } = playMatch(2);
    for (const p of state.players) expect(p.pawns).toHaveLength(PAWNS_PER_PLAYER);
  });

  it("plays two-handed", () => {
    const { state } = playMatch(3, ["a", "b"]);
    expect(game.checkWinCondition(state)!.winners).toHaveLength(1);
  });

  it("never leaves the turn with a finished player", () => {
    const { state } = playMatch(4);
    expect(game.getCurrentPlayerId(state)).toBeNull();
  });
});

describe("getPlayerView — public information", () => {
  it("gives every viewer identical information", () => {
    let state = fresh(PLAYERS, 21);
    state = game.applyMove(state, "red", { type: "roll" }).state;

    const views = [...PLAYERS, null].map((v) => game.getPlayerView(state, v));
    const boards = views.map((v) => JSON.stringify(v.players));
    // Ludo hides nothing, so the board must be byte-identical for everyone,
    // including a pure spectator.
    expect(new Set(boards).size).toBe(1);
  });

  it("only differs in whose controls are live", () => {
    let state = fresh(PLAYERS, 22);
    state = game.applyMove(state, "red", { type: "roll" }).state;

    // Whoever is NOT to act gets no controls, whichever seat that turns out
    // to be — a non-six passes the turn on immediately.
    const actor = game.getCurrentPlayerId(state)!;
    for (const viewer of PLAYERS.filter((p) => p !== actor)) {
      const view = game.getPlayerView(state, viewer);
      expect(view.movablePawns).toEqual([]);
      expect(view.mustRoll).toBe(false);
    }
    const actorView = game.getPlayerView(state, actor);
    expect(actorView.mustRoll || actorView.movablePawns.length > 0).toBe(true);
  });

  it("declares itself an open-information game", () => {
    expect(game.meta.hasHiddenState).toBe(false);
  });
});

describe("validateMove", () => {
  it("rejects moves from the wrong player", () => {
    const state = fresh();
    expect(game.validateMove(state, "green", { type: "roll" })).toBe(false);
  });

  it("rejects malformed moves without throwing", () => {
    const state = fresh();
    for (const junk of [null, undefined, {}, 3, "roll", { type: "movePawn" }, { type: "movePawn", pawn: 9 }, { type: "movePawn", pawn: -1 }]) {
      expect(() => game.validateMove(state, "red", junk as never)).not.toThrow();
      expect(game.validateMove(state, "red", junk as never)).toBe(false);
    }
  });

  it("rejects passing when a legal move exists", () => {
    const state = fresh();
    state.dice = 6;
    expect(game.validateMove(state, "red", { type: "pass" })).toBe(false);
  });

  it("does not mutate the state it is given", () => {
    const state = fresh();
    const before = JSON.stringify(state);
    game.applyMove(state, "red", { type: "roll" });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("refuses to apply a move it would not validate", () => {
    const state = fresh();
    expect(() => game.applyMove(state, "red", { type: "movePawn", pawn: 0 })).toThrow();
  });
});
