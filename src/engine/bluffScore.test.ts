import { describe, it, expect } from "vitest";
import { buildPostMatchReport } from "./bluffScore";
import { GameState, RoundResult } from "./types";

function makeState(history: RoundResult[], playerIds: string[]): GameState {
  return {
    players: playerIds.map((id) => ({ id, diceCount: 5, dice: [], eliminated: false })),
    currentPlayerIndex: 0,
    currentBid: null,
    bidderIndex: null,
    round: history.length + 1,
    palifico: false,
    phase: "gameOver",
    winnerId: playerIds[0] ?? null,
    history,
    rngSeed: 1,
  };
}

describe("buildPostMatchReport", () => {
  it("flags an outrageous bid that succeeded as bluff-succeeded", () => {
    // Bidder has zero 5s themselves and claims 6 fives exist among only 10 dice total.
    const result: RoundResult = {
      round: 1,
      bid: { quantity: 6, face: 5 },
      bidderId: "a",
      challengerId: "b",
      actualCount: 6,
      wildOnesCounted: true,
      bidderWon: true,
      loserId: "b",
      allHands: {
        a: [2, 3, 4, 6, 2],
        b: [5, 5, 5, 5, 5],
      },
    };
    const state = makeState([result], ["a", "b"]);
    const report = buildPostMatchReport(state);
    expect(report.rounds).toHaveLength(1);
    expect(report.rounds[0]!.verdict).toBe("bluff-succeeded");
    expect(report.rounds[0]!.probabilityBidderView).toBeLessThan(0.4);
  });

  it("flags an outrageous bid that failed as bluff-caught", () => {
    const result: RoundResult = {
      round: 1,
      bid: { quantity: 6, face: 5 },
      bidderId: "a",
      challengerId: "b",
      actualCount: 1,
      wildOnesCounted: true,
      bidderWon: false,
      loserId: "a",
      allHands: {
        a: [2, 3, 4, 6, 2],
        b: [5, 2, 3, 4, 6],
      },
    };
    const state = makeState([result], ["a", "b"]);
    const report = buildPostMatchReport(state);
    expect(report.rounds[0]!.verdict).toBe("bluff-caught");
  });

  it("treats a near-certain bid the bidder won as an honest bid", () => {
    // Bidder holds three 1s (wild) themselves and only needs 1 more among 5 unknown dice.
    const result: RoundResult = {
      round: 1,
      bid: { quantity: 4, face: 3 },
      bidderId: "a",
      challengerId: "b",
      actualCount: 4,
      wildOnesCounted: true,
      bidderWon: true,
      loserId: "b",
      allHands: {
        a: [1, 1, 1, 2, 6],
        b: [3, 2, 4, 5, 6],
      },
    };
    const state = makeState([result], ["a", "b"]);
    const report = buildPostMatchReport(state);
    expect(report.rounds[0]!.verdict).toBe("honest-bid");
    expect(report.rounds[0]!.probabilityBidderView).toBeGreaterThanOrEqual(0.4);
  });

  it("aggregates per-player bid and challenge stats", () => {
    const result: RoundResult = {
      round: 1,
      bid: { quantity: 6, face: 5 },
      bidderId: "a",
      challengerId: "b",
      actualCount: 6,
      wildOnesCounted: true,
      bidderWon: true,
      loserId: "b",
      allHands: { a: [2, 3, 4, 6, 2], b: [5, 5, 5, 5, 5] },
    };
    const state = makeState([result], ["a", "b"]);
    const report = buildPostMatchReport(state);
    const a = report.players.find((p) => p.playerId === "a")!;
    const b = report.players.find((p) => p.playerId === "b")!;
    expect(a.bidsMade).toBe(1);
    expect(a.bluffsSucceeded).toBe(1);
    expect(b.challengesMade).toBe(1);
  });
});
