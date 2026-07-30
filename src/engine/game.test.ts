import { describe, it, expect } from "vitest";
import { applyAction, createGame, InvalidActionError, isValidBidTransition, totalDice } from "./game";

describe("isValidBidTransition", () => {
  it("allows any first bid with quantity >= 1", () => {
    expect(isValidBidTransition(null, { quantity: 1, face: 2 }, false)).toBe(true);
    expect(isValidBidTransition(null, { quantity: 0, face: 2 }, false)).toBe(false);
  });

  it("requires strictly higher quantity, or same quantity with higher face, in the same lane", () => {
    expect(isValidBidTransition({ quantity: 3, face: 4 }, { quantity: 4, face: 2 }, false)).toBe(true);
    expect(isValidBidTransition({ quantity: 3, face: 4 }, { quantity: 3, face: 5 }, false)).toBe(true);
    expect(isValidBidTransition({ quantity: 3, face: 4 }, { quantity: 3, face: 3 }, false)).toBe(false);
    expect(isValidBidTransition({ quantity: 3, face: 4 }, { quantity: 2, face: 6 }, false)).toBe(false);
  });

  it("applies the halving rule when switching onto ones", () => {
    // prev qty 8 -> min ones qty = floor(8/2)+1 = 5
    expect(isValidBidTransition({ quantity: 8, face: 4 }, { quantity: 5, face: 1 }, false)).toBe(true);
    expect(isValidBidTransition({ quantity: 8, face: 4 }, { quantity: 4, face: 1 }, false)).toBe(false);
  });

  it("applies the doubling rule when switching off ones", () => {
    // prev qty 4 (ones) -> min non-ones qty = 4*2+1 = 9
    expect(isValidBidTransition({ quantity: 4, face: 1 }, { quantity: 9, face: 2 }, false)).toBe(true);
    expect(isValidBidTransition({ quantity: 4, face: 1 }, { quantity: 8, face: 6 }, false)).toBe(false);
  });

  it("during palifico, only allows the same face with a strictly higher quantity", () => {
    expect(isValidBidTransition({ quantity: 2, face: 3 }, { quantity: 3, face: 3 }, true)).toBe(true);
    expect(isValidBidTransition({ quantity: 2, face: 3 }, { quantity: 3, face: 4 }, true)).toBe(false);
    expect(isValidBidTransition({ quantity: 2, face: 3 }, { quantity: 5, face: 1 }, true)).toBe(false);
  });
});

describe("applyAction", () => {
  it("rejects actions from a player who is not up", () => {
    const state = createGame(["a", "b", "c"], 1);
    expect(() => applyAction(state, { type: "bid", playerId: "b", bid: { quantity: 1, face: 2 } })).toThrow(
      InvalidActionError
    );
  });

  it("rejects challenge with no active bid", () => {
    const state = createGame(["a", "b"], 1);
    expect(() => applyAction(state, { type: "challenge", playerId: "a" })).toThrow(InvalidActionError);
  });

  it("rejects illegal bid transitions", () => {
    let state = createGame(["a", "b"], 1);
    state = applyAction(state, { type: "bid", playerId: "a", bid: { quantity: 3, face: 4 } });
    expect(() =>
      applyAction(state, { type: "bid", playerId: "b", bid: { quantity: 2, face: 4 } })
    ).toThrow(InvalidActionError);
  });

  it("never sends opponents' dice to the reducer's public surface implicitly (dice only change via reroll)", () => {
    let state = createGame(["a", "b"], 1);
    const aHandBefore = state.players[0]!.dice;
    state = applyAction(state, { type: "bid", playerId: "a", bid: { quantity: 1, face: 2 } });
    expect(state.players[0]!.dice).toEqual(aHandBefore);
  });

  it("resolves a challenge, decrements exactly one die, and starts next round with the loser", () => {
    let state = createGame(["a", "b"], 42);
    state = applyAction(state, { type: "bid", playerId: "a", bid: { quantity: 1, face: 2 } });
    const before = totalDice(state);
    state = applyAction(state, { type: "challenge", playerId: "b" });
    expect(totalDice(state)).toBe(before - 1);
    expect(state.history).toHaveLength(1);
    const loserId = state.history[0]!.loserId;
    if (state.phase === "bidding") {
      expect(state.players[state.currentPlayerIndex]!.id).toBe(loserId);
    }
  });

  it("eliminates a player when their dice count reaches zero and ends the game with one winner", () => {
    const ids = ["a", "b"];
    let state = createGame(ids, 1);
    // Force a's dice down to 0 by driving repeated deterministic challenges is
    // slow to hand-construct; instead assert the invariant on a short forced path:
    // reduce b to elimination manually is not exposed, so just check phase logic
    // end-to-end via a fixed sequence of legal actions until game over.
    let guard = 0;
    while (state.phase !== "gameOver" && guard++ < 2000) {
      const current = state.players[state.currentPlayerIndex]!;
      if (state.currentBid === null) {
        state = applyAction(state, { type: "bid", playerId: current.id, bid: { quantity: 1, face: 2 } });
      } else {
        state = applyAction(state, { type: "challenge", playerId: current.id });
      }
    }
    expect(state.phase).toBe("gameOver");
    const active = state.players.filter((p) => !p.eliminated);
    expect(active).toHaveLength(1);
    expect(state.winnerId).toBe(active[0]!.id);
  });
});
