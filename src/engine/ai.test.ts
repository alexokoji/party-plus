import { describe, it, expect } from "vitest";
import { bidTruthProbability, chooseAction, countOwnMatches, matchProbability } from "./ai";
import { applyAction, createGame, isValidBidTransition } from "./game";
import type { Face, GameState } from "./types";

function stateWith(overrides: Partial<GameState>): GameState {
  const base = createGame(["a", "b", "c"], 7);
  return { ...base, ...overrides };
}

describe("matchProbability", () => {
  it("counts ones as wild (2 in 6) for non-one faces", () => {
    expect(matchProbability(4, true)).toBeCloseTo(2 / 6);
  });
  it("never treats ones as wild for a bid on ones", () => {
    expect(matchProbability(1, true)).toBeCloseTo(1 / 6);
  });
  it("drops to 1 in 6 during palifico", () => {
    expect(matchProbability(4, false)).toBeCloseTo(1 / 6);
  });
});

describe("countOwnMatches", () => {
  it("counts exact faces plus wild ones", () => {
    expect(countOwnMatches([1, 4, 4, 2, 6], 4, true)).toBe(3);
  });
  it("does not double-count when bidding on ones", () => {
    expect(countOwnMatches([1, 1, 4, 2, 6], 1, true)).toBe(2);
  });
  it("ignores wilds during palifico", () => {
    expect(countOwnMatches([1, 4, 4, 2, 6], 4, false)).toBe(2);
  });
});

describe("bidTruthProbability", () => {
  it("is certain when the hand alone already satisfies the bid", () => {
    expect(bidTruthProbability({ quantity: 2, face: 5 }, [5, 5, 3, 2, 6], 15, true)).toBe(1);
  });

  it("is impossible when the bid exceeds every die in play", () => {
    expect(bidTruthProbability({ quantity: 30, face: 5 }, [5, 5, 3, 2, 6], 15, true)).toBe(0);
  });

  it("decreases as the claimed quantity rises", () => {
    const hand: Face[] = [5, 3, 2, 6, 4];
    let prev = 1.1;
    for (let q = 1; q <= 10; q++) {
      const p = bidTruthProbability({ quantity: q, face: 5 }, hand, 15, true);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });
});

describe("chooseAction", () => {
  it("challenges a wildly implausible bid", () => {
    const state = stateWith({});
    const player = state.players[0]!;
    player.dice = [2, 3, 4, 6, 2];
    const withBid: GameState = {
      ...state,
      currentBid: { quantity: 14, face: 5 },
      bidderIndex: 1,
      currentPlayerIndex: 0,
    };
    const action = chooseAction(withBid, player.id);
    expect(action.type).toBe("challenge");
  });

  it("does not challenge a bid its own hand already guarantees", () => {
    const state = stateWith({});
    const player = state.players[0]!;
    player.dice = [5, 5, 5, 5, 5];
    const withBid: GameState = {
      ...state,
      currentBid: { quantity: 3, face: 5 },
      bidderIndex: 1,
      currentPlayerIndex: 0,
    };
    expect(chooseAction(withBid, player.id).type).toBe("bid");
  });

  it("opens with a legal bid when there is nothing to challenge", () => {
    const state = stateWith({});
    const action = chooseAction(state, state.players[0]!.id);
    expect(action.type).toBe("bid");
    if (action.type === "bid") {
      expect(isValidBidTransition(null, action.bid, state.palifico)).toBe(true);
    }
  });

  it("only ever returns actions the rules engine accepts", () => {
    // Play many full matches driven entirely by the AI; applyAction throws on
    // any illegal move, so completing them proves the policy stays legal.
    for (let seed = 1; seed <= 40; seed++) {
      let state = createGame(["a", "b", "c", "d"], seed);
      let guard = 0;
      while (state.phase !== "gameOver") {
        if (guard++ > 3000) throw new Error(`match ${seed} failed to terminate`);
        const current = state.players[state.currentPlayerIndex]!;
        state = applyAction(state, chooseAction(state, current.id));
      }
      expect(state.players.filter((p) => !p.eliminated)).toHaveLength(1);
    }
  });

  it("respects palifico, where only the quantity may rise", () => {
    const base = createGame(["a", "b", "c"], 3);
    const state: GameState = {
      ...base,
      palifico: true,
      currentBid: { quantity: 2, face: 3 },
      bidderIndex: 1,
      currentPlayerIndex: 0,
    };
    const action = chooseAction(state, state.players[0]!.id);
    if (action.type === "bid") {
      expect(action.bid.face).toBe(3);
      expect(action.bid.quantity).toBeGreaterThan(2);
    }
  });

  it("beats a purely random policy over many matches", () => {
    // A strategy check, not just a legality check: the AI should actually win.
    let aiWins = 0;
    const matches = 40;
    for (let seed = 1; seed <= matches; seed++) {
      let state = createGame(["ai", "rand"], seed);
      let guard = 0;
      while (state.phase !== "gameOver" && guard++ < 3000) {
        const current = state.players[state.currentPlayerIndex]!;
        if (current.id === "ai") {
          state = applyAction(state, chooseAction(state, current.id));
        } else {
          // Deliberately naive opponent: always makes the minimum legal raise,
          // never challenges, which is a losing strategy at Perudo.
          const totalDice = state.players.reduce((s, p) => s + p.diceCount, 0);
          let placed = false;
          for (let q = 1; q <= totalDice && !placed; q++) {
            for (const face of [1, 2, 3, 4, 5, 6] as Face[]) {
              if (isValidBidTransition(state.currentBid, { quantity: q, face }, state.palifico)) {
                state = applyAction(state, { type: "bid", playerId: current.id, bid: { quantity: q, face } });
                placed = true;
                break;
              }
            }
          }
          if (!placed) state = applyAction(state, { type: "challenge", playerId: current.id });
        }
      }
      if (state.winnerId === "ai") aiWins++;
    }
    expect(aiWins).toBeGreaterThan(matches * 0.6);
  });
});
