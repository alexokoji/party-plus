import { describe, it, expect } from "vitest";
import {
  BLOCK_DOMINOES,
  buildSet,
  DOMINOES_VARIANTS,
  dominoesModule as game,
  DRAW_DOMINOES,
  fittingEnds,
  getDominoesVariant,
  openEnds,
  pipTotal,
  playableTiles,
  type DominoesState,
  type Tile,
} from "./module";

const PLAYERS = ["ana", "ben", "cleo"];

const tile = (a: number, b: number): Tile => ({ id: `${Math.min(a, b)}-${Math.max(a, b)}`, a, b });

function fresh(players = PLAYERS, seed = 1, variant = "block"): DominoesState {
  return game.createInitialState(players, { seed, variant });
}

function playMatch(seed: number, variant = "block", players = PLAYERS) {
  let state = fresh(players, seed, variant);
  let moves = 0;
  while (game.checkWinCondition(state) === null) {
    if (moves++ > 3000) throw new Error(`${variant} seed ${seed} did not terminate`);
    const actor = game.getCurrentPlayerId(state)!;
    const move = game.getTimeoutMove!(state, actor)!;
    expect(game.validateMove(state, actor, move)).toBe(true);
    state = game.applyMove(state, actor, move).state;
  }
  return { state, moves };
}

describe("the set", () => {
  it("is a double-six set of 28 unique tiles", () => {
    const set = buildSet();
    expect(set).toHaveLength(28);
    expect(new Set(set.map((t) => t.id)).size).toBe(28);
    for (const t of set) {
      expect(t.a).toBeLessThanOrEqual(t.b);
      expect(t.b).toBeLessThanOrEqual(6);
    }
  });

  it("contains exactly seven doubles", () => {
    expect(buildSet().filter((t) => t.a === t.b)).toHaveLength(7);
  });

  it("totals 168 pips", () => {
    expect(pipTotal(buildSet())).toBe(168);
  });

  it("conserves every tile at the deal", () => {
    const state = fresh();
    const all = state.boneyard.length + state.players.reduce((s, p) => s + p.hand.length, 0);
    expect(all).toBe(28);
  });

  it("deals seven tiles each", () => {
    expect(fresh().players.every((p) => p.hand.length === BLOCK_DOMINOES.handSize)).toBe(true);
  });

  it("opens with whoever holds the highest double", () => {
    const state = fresh(PLAYERS, 12);
    const opener = state.players[state.currentIndex]!;
    const openerBest = Math.max(-1, ...opener.hand.filter((t) => t.a === t.b).map((t) => t.a));
    for (const p of state.players) {
      const best = Math.max(-1, ...p.hand.filter((t) => t.a === t.b).map((t) => t.a));
      expect(openerBest).toBeGreaterThanOrEqual(best);
    }
  });
});

describe("matching the open ends", () => {
  it("tracks both ends of the chain", () => {
    const state = fresh();
    state.layout = [
      { id: "3-5", left: 3, right: 5, isDouble: false },
      { id: "5-2", left: 5, right: 2, isDouble: false },
    ];
    expect(openEnds(state)).toEqual({ left: 3, right: 2 });
  });

  it("reports both ends as null before the first tile", () => {
    expect(openEnds(fresh())).toEqual({ left: null, right: null });
  });

  it("fits a tile to whichever end matches", () => {
    const state = fresh();
    state.layout = [{ id: "3-5", left: 3, right: 5, isDouble: false }];
    expect(fittingEnds(state, tile(1, 3))).toEqual(["left"]);
    expect(fittingEnds(state, tile(5, 6))).toEqual(["right"]);
    expect(fittingEnds(state, tile(2, 4))).toEqual([]);
  });

  it("fits both ends when a tile matches both", () => {
    const state = fresh();
    state.layout = [{ id: "3-5", left: 3, right: 5, isDouble: false }];
    expect(fittingEnds(state, tile(3, 5)).sort()).toEqual(["left", "right"]);
  });

  it("orients the tile so the matching pip touches the chain", () => {
    const state = fresh(["p1", "p2"]);
    state.layout = [{ id: "3-5", left: 3, right: 5, isDouble: false }];
    state.currentIndex = 0;
    state.players[0]!.hand = [tile(6, 5)];

    const { state: after } = game.applyMove(state, "p1", { type: "play", tileId: "5-6", end: "right" });
    const placed = after.layout[after.layout.length - 1]!;
    // The 5 must face inward, leaving the 6 as the new open end.
    expect(placed.left).toBe(5);
    expect(placed.right).toBe(6);
    expect(openEnds(after).right).toBe(6);
  });

  it("orients correctly when playing on the left", () => {
    const state = fresh(["p1", "p2"]);
    state.layout = [{ id: "3-5", left: 3, right: 5, isDouble: false }];
    state.currentIndex = 0;
    state.players[0]!.hand = [tile(3, 1)];

    const { state: after } = game.applyMove(state, "p1", { type: "play", tileId: "1-3", end: "left" });
    const placed = after.layout[0]!;
    expect(placed.right).toBe(3);
    expect(placed.left).toBe(1);
    expect(openEnds(after).left).toBe(1);
  });

  it("rejects a tile that matches neither end", () => {
    const state = fresh(["p1", "p2"]);
    state.layout = [{ id: "3-5", left: 3, right: 5, isDouble: false }];
    state.currentIndex = 0;
    state.players[0]!.hand = [tile(2, 4)];
    expect(game.validateMove(state, "p1", { type: "play", tileId: "2-4", end: "left" })).toBe(false);
  });

  it("rejects playing on the wrong end", () => {
    const state = fresh(["p1", "p2"]);
    state.layout = [{ id: "3-5", left: 3, right: 5, isDouble: false }];
    state.currentIndex = 0;
    state.players[0]!.hand = [tile(1, 3)];
    expect(game.validateMove(state, "p1", { type: "play", tileId: "1-3", end: "right" })).toBe(false);
    expect(game.validateMove(state, "p1", { type: "play", tileId: "1-3", end: "left" })).toBe(true);
  });
});

describe("block variant", () => {
  it("does not allow drawing", () => {
    const state = fresh(["p1", "p2"], 1, "block");
    state.currentIndex = 0;
    state.layout = [{ id: "3-5", left: 3, right: 5, isDouble: false }];
    state.players[0]!.hand = [tile(2, 4)];
    expect(BLOCK_DOMINOES.allowDraw).toBe(false);
    expect(game.validateMove(state, "p1", { type: "draw" })).toBe(false);
    expect(game.validateMove(state, "p1", { type: "pass" })).toBe(true);
  });

  it("ends on pip count when everyone is stuck", () => {
    const state = fresh(["p1", "p2"], 1, "block");
    state.layout = [{ id: "3-3", left: 3, right: 3, isDouble: true }];
    state.boneyard = [];
    state.currentIndex = 0;
    state.players[0]!.hand = [tile(1, 2)]; // 3 pips
    state.players[1]!.hand = [tile(5, 6)]; // 11 pips

    let current = game.applyMove(state, "p1", { type: "pass" }).state;
    current = game.applyMove(current, "p2", { type: "pass" }).state;

    expect(current.finished).toBe(true);
    expect(current.endReason).toBe("blocked");
    expect(current.winners).toEqual(["p1"]);
    expect(current.finalPips).toEqual({ p1: 3, p2: 11 });
  });

  it("splits a blocked game between equal pip counts", () => {
    const state = fresh(["p1", "p2"], 1, "block");
    state.layout = [{ id: "3-3", left: 3, right: 3, isDouble: true }];
    state.boneyard = [];
    state.currentIndex = 0;
    state.players[0]!.hand = [tile(1, 2)];
    state.players[1]!.hand = [tile(1, 2)];

    let current = game.applyMove(state, "p1", { type: "pass" }).state;
    current = game.applyMove(current, "p2", { type: "pass" }).state;
    expect(current.winners.sort()).toEqual(["p1", "p2"]);
  });
});

describe("draw variant", () => {
  it("allows drawing only when stuck", () => {
    const state = fresh(["p1", "p2"], 1, "draw");
    state.currentIndex = 0;
    state.layout = [{ id: "3-5", left: 3, right: 5, isDouble: false }];
    state.boneyard = [tile(0, 0)];

    // Holding a playable tile means no draw.
    state.players[0]!.hand = [tile(1, 3)];
    expect(game.validateMove(state, "p1", { type: "draw" })).toBe(false);

    // Stuck: drawing is allowed.
    state.players[0]!.hand = [tile(2, 4)];
    expect(DRAW_DOMINOES.allowDraw).toBe(true);
    expect(game.validateMove(state, "p1", { type: "draw" })).toBe(true);
  });

  it("keeps the turn with the drawer so they can play what they drew", () => {
    const state = fresh(["p1", "p2"], 1, "draw");
    state.currentIndex = 0;
    state.layout = [{ id: "3-5", left: 3, right: 5, isDouble: false }];
    state.players[0]!.hand = [tile(2, 4)];
    state.boneyard = [tile(3, 6)];

    const { state: after } = game.applyMove(state, "p1", { type: "draw" });
    expect(game.getCurrentPlayerId(after)).toBe("p1");
    expect(after.players[0]!.hand).toHaveLength(2);
    expect(after.boneyard).toHaveLength(0);
  });

  it("forbids passing while the boneyard still has tiles", () => {
    const state = fresh(["p1", "p2"], 1, "draw");
    state.currentIndex = 0;
    state.layout = [{ id: "3-5", left: 3, right: 5, isDouble: false }];
    state.players[0]!.hand = [tile(2, 4)];
    state.boneyard = [tile(0, 0)];
    expect(game.validateMove(state, "p1", { type: "pass" })).toBe(false);

    state.boneyard = [];
    expect(game.validateMove(state, "p1", { type: "pass" })).toBe(true);
  });
});

describe("hidden tiles", () => {
  it("shows a player their own tiles and only counts for others", () => {
    const state = fresh();
    for (const id of PLAYERS) {
      const view = game.getPlayerView(state, id);
      expect(view.myHand).toHaveLength(7);
      for (const o of view.opponents) {
        expect(o.tileCount).toBe(7);
        expect(Object.keys(o).sort()).toEqual(["id", "tileCount"]);
      }
      expect(view.allHands).toEqual({});
    }
  });

  it("never serialises an opponent's tiles", () => {
    const state = fresh();
    const view = game.getPlayerView(state, "ana");
    const wire = JSON.stringify(view);
    for (const p of state.players) {
      if (p.id === "ana") continue;
      for (const t of p.hand) {
        const mine = view.myHand.some((m) => m.id === t.id);
        // A tile id in the layout is public; one still in a hand is not.
        const inLayout = view.layout.some((l) => l.id === t.id);
        if (!mine && !inLayout) expect(wire).not.toContain(`"${t.id}"`);
      }
    }
  });

  it("keeps tiles hidden on every turn of a real game", () => {
    let state = fresh(PLAYERS, 4);
    let guard = 0;
    while (game.checkWinCondition(state) === null && guard++ < 2000) {
      for (const viewer of PLAYERS) {
        expect(game.getPlayerView(state, viewer).allHands).toEqual({});
      }
      const actor = game.getCurrentPlayerId(state)!;
      state = game.applyMove(state, actor, game.getTimeoutMove!(state, actor)!).state;
    }
  });

  it("opens every hand to a spectator", () => {
    const view = game.getPlayerView(fresh(), null);
    expect(view.seesAllHands).toBe(true);
    expect(Object.keys(view.allHands)).toHaveLength(PLAYERS.length);
    expect(view.myHand).toEqual([]);
  });

  it("only offers playable tiles to the player to act", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    const other = PLAYERS.find((p) => p !== actor)!;
    expect(game.getPlayerView(state, other).playable).toEqual([]);
    expect(game.getPlayerView(state, actor).playable.length).toBeGreaterThan(0);
  });
});

describe("full games", () => {
  it.each(DOMINOES_VARIANTS.map((v) => v.id))("terminates with a winner (%s)", (variant) => {
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = playMatch(seed, variant);
      const win = game.checkWinCondition(state)!;
      expect(win.finished).toBe(true);
      expect(win.winners.length).toBeGreaterThan(0);
      expect(["emptyHand", "blocked"]).toContain(state.endReason);
    }
  });

  it("conserves all 28 tiles throughout", () => {
    const { state } = playMatch(3);
    const total =
      state.boneyard.length +
      state.layout.length +
      state.players.reduce((s, p) => s + p.hand.length, 0);
    expect(total).toBe(28);
  });

  it("keeps the chain internally consistent", () => {
    const { state } = playMatch(5);
    for (let i = 1; i < state.layout.length; i++) {
      // Touching pips must match all the way along.
      expect(state.layout[i - 1]!.right).toBe(state.layout[i]!.left);
    }
  });

  it("plays two-handed and four-handed", () => {
    expect(game.checkWinCondition(playMatch(2, "draw", ["a", "b"]).state)!.finished).toBe(true);
    expect(
      game.checkWinCondition(playMatch(6, "draw", ["a", "b", "c", "d"]).state)!.finished
    ).toBe(true);
  });
});

describe("validation", () => {
  it("rejects moves out of turn", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    const other = PLAYERS.find((p) => p !== actor)!;
    expect(game.validateMove(state, other, { type: "pass" })).toBe(false);
  });

  it("rejects a tile the player does not hold", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    expect(game.validateMove(state, actor, { type: "play", tileId: "nope", end: "left" })).toBe(false);
  });

  it("rejects malformed moves without throwing", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    for (const junk of [
      null,
      undefined,
      {},
      3,
      "play",
      { type: "play" },
      { type: "play", tileId: 5, end: "left" },
      { type: "play", tileId: "0-0", end: "middle" },
    ]) {
      expect(() => game.validateMove(state, actor, junk as never)).not.toThrow();
      expect(game.validateMove(state, actor, junk as never)).toBe(false);
    }
  });

  it("does not mutate the state it is given", () => {
    const state = fresh();
    const before = JSON.stringify(state);
    const actor = game.getCurrentPlayerId(state)!;
    game.applyMove(state, actor, game.getTimeoutMove!(state, actor)!);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("falls back to the block variant for an unknown id", () => {
    expect(getDominoesVariant("nope").id).toBe("block");
  });
});
