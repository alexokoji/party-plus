import { describe, it, expect } from "vitest";
import { applyAction, createGame, totalDice } from "./game";
import type { Bid, Face, GameState } from "./types";

/** Drives the game to a challenge resolution and returns the state after it. */
function resolveChallenge(state: GameState, bid: Bid = { quantity: 1, face: 2 }): GameState {
  const bidder = state.players[state.currentPlayerIndex]!;
  const afterBid = applyAction(state, { type: "bid", playerId: bidder.id, bid });
  const challenger = afterBid.players[afterBid.currentPlayerIndex]!;
  return applyAction(afterBid, { type: "challenge", playerId: challenger.id });
}

function activeIds(state: GameState): string[] {
  return state.players.filter((p) => !p.eliminated).map((p) => p.id);
}

describe("turn order", () => {
  it("passes the turn to the next seat after a bid", () => {
    const state = createGame(["a", "b", "c", "d"], 5);
    expect(state.players[state.currentPlayerIndex]!.id).toBe("a");
    const next = applyAction(state, { type: "bid", playerId: "a", bid: { quantity: 1, face: 3 } });
    expect(next.players[next.currentPlayerIndex]!.id).toBe("b");
  });

  it("wraps around the table rather than running off the end", () => {
    let state = createGame(["a", "b", "c"], 5);
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const actor = state.players[state.currentPlayerIndex]!;
      seen.push(actor.id);
      state = applyAction(state, {
        type: "bid",
        playerId: actor.id,
        bid: { quantity: i + 1, face: 3 },
      });
    }
    expect(seen).toEqual(["a", "b", "c", "a", "b", "c"]);
  });

  it("only ever lets the player whose turn it is act", () => {
    const state = createGame(["a", "b", "c"], 5);
    for (const wrongPlayer of ["b", "c"]) {
      expect(() =>
        applyAction(state, { type: "bid", playerId: wrongPlayer, bid: { quantity: 1, face: 3 } })
      ).toThrow();
    }
  });

  it("starts the next round with whoever lost the die", () => {
    let state = createGame(["a", "b", "c", "d"], 11);
    for (let round = 0; round < 6 && state.phase === "bidding"; round++) {
      const before = state;
      state = resolveChallenge(before);
      if (state.phase !== "bidding") break;
      const loserId = state.history[state.history.length - 1]!.loserId;
      const loser = state.players.find((p) => p.id === loserId)!;
      if (!loser.eliminated) {
        expect(state.players[state.currentPlayerIndex]!.id).toBe(loserId);
      }
    }
  });

  it("skips an eliminated loser and starts with the next surviving seat", () => {
    let state = createGame(["a", "b", "c"], 3);
    let sawElimination = false;
    for (let i = 0; i < 200 && state.phase === "bidding"; i++) {
      state = resolveChallenge(state);
      const last = state.history[state.history.length - 1]!;
      const loser = state.players.find((p) => p.id === last.loserId)!;
      if (loser.eliminated && state.phase === "bidding") {
        sawElimination = true;
        const starter = state.players[state.currentPlayerIndex]!;
        expect(starter.eliminated).toBe(false);
        expect(starter.id).not.toBe(last.loserId);
        break;
      }
    }
    expect(sawElimination).toBe(true);
  });

  it("never hands the turn to an eliminated player", () => {
    let state = createGame(["a", "b", "c", "d"], 21);
    for (let i = 0; i < 400 && state.phase === "bidding"; i++) {
      expect(state.players[state.currentPlayerIndex]!.eliminated).toBe(false);
      state = resolveChallenge(state);
    }
    expect(state.phase).toBe("gameOver");
  });
});

describe("round transitions", () => {
  it("clears the standing bid so each round starts fresh", () => {
    const state = resolveChallenge(createGame(["a", "b", "c"], 9));
    if (state.phase === "bidding") {
      expect(state.currentBid).toBeNull();
      expect(state.bidderIndex).toBeNull();
    }
  });

  it("rerolls every surviving hand between rounds", () => {
    const start = createGame(["a", "b", "c"], 13);
    const handsBefore = start.players.map((p) => p.dice.join(""));
    const after = resolveChallenge(start);
    if (after.phase === "bidding") {
      const handsAfter = after.players.map((p) => p.dice.join(""));
      // At least one hand must differ; identical hands across a reroll would
      // mean dice were never re-thrown.
      expect(handsAfter.join("|")).not.toBe(handsBefore.join("|"));
    }
  });

  it("keeps each hand's size equal to that player's remaining dice count", () => {
    let state = createGame(["a", "b", "c"], 17);
    for (let i = 0; i < 60 && state.phase === "bidding"; i++) {
      for (const p of state.players) {
        expect(p.dice).toHaveLength(p.eliminated ? 0 : p.diceCount);
      }
      state = resolveChallenge(state);
    }
  });

  it("removes exactly one die from play per challenge", () => {
    let state = createGame(["a", "b", "c", "d"], 23);
    while (state.phase === "bidding") {
      const before = totalDice(state);
      state = resolveChallenge(state);
      expect(totalDice(state)).toBe(before - 1);
    }
  });
});

describe("palifico", () => {
  it("turns on exactly when a surviving player is down to one die", () => {
    let state = createGame(["a", "b", "c"], 31);
    for (let i = 0; i < 300 && state.phase === "bidding"; i++) {
      const anyOnOne = state.players.some((p) => !p.eliminated && p.diceCount === 1);
      expect(state.palifico).toBe(anyOnOne);
      state = resolveChallenge(state);
    }
  });

  it("stops counting ones as wild while it is active", () => {
    let state = createGame(["a", "b", "c"], 31);
    for (let i = 0; i < 300 && state.phase === "bidding"; i++) {
      const wasPalifico = state.palifico;
      state = resolveChallenge(state, { quantity: 1, face: 2 });
      const result = state.history[state.history.length - 1]!;
      expect(result.wildOnesCounted).toBe(!wasPalifico);

      // Recount by hand to confirm the engine applied the rule it reported.
      const expected = Object.values(result.allHands)
        .flat()
        .filter((die: Face) =>
          die === result.bid.face || (result.wildOnesCounted && die === 1 && result.bid.face !== 1)
        ).length;
      expect(result.actualCount).toBe(expected);
    }
  });
});

describe("end of match", () => {
  it("ends with exactly one survivor holding every remaining die", () => {
    for (let seed = 1; seed <= 25; seed++) {
      let state = createGame(["a", "b", "c", "d"], seed);
      let guard = 0;
      while (state.phase === "bidding") {
        if (guard++ > 2000) throw new Error(`seed ${seed} never ended`);
        state = resolveChallenge(state);
      }
      const survivors = activeIds(state);
      expect(survivors).toHaveLength(1);
      expect(state.winnerId).toBe(survivors[0]);
      expect(totalDice(state)).toBe(state.players.find((p) => p.id === state.winnerId)!.diceCount);
    }
  });

  it("refuses any further action once the match is over", () => {
    let state = createGame(["a", "b"], 2);
    while (state.phase === "bidding") state = resolveChallenge(state);
    expect(() =>
      applyAction(state, { type: "bid", playerId: state.winnerId!, bid: { quantity: 1, face: 2 } })
    ).toThrow();
  });
});
