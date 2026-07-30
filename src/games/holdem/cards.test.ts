import { describe, it, expect } from "vitest";
import {
  buildDeck,
  cardId,
  compareHands,
  evaluateHand,
  shuffleDeck,
  type Card,
  type Suit,
} from "./cards";

/** "As Kd 7h" → cards. Rank chars: 2-9, T, J, Q, K, A. */
function hand(spec: string): Card[] {
  const RANKS: Record<string, number> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
  return spec.trim().split(/\s+/).map((token) => {
    const rankChar = token.slice(0, -1);
    const suit = token.slice(-1) as Suit;
    return { rank: RANKS[rankChar] ?? Number(rankChar), suit };
  });
}

const evalOf = (spec: string) => evaluateHand(hand(spec));

describe("deck", () => {
  it("has 52 unique cards", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardId)).size).toBe(52);
  });

  it("shuffles deterministically from a state and keeps every card", () => {
    const a = shuffleDeck(buildDeck(), 123);
    const b = shuffleDeck(buildDeck(), 123);
    expect(a.deck.map(cardId)).toEqual(b.deck.map(cardId));
    expect(new Set(a.deck.map(cardId)).size).toBe(52);
    // A different state must give a different order.
    const c = shuffleDeck(buildDeck(), 124);
    expect(c.deck.map(cardId)).not.toEqual(a.deck.map(cardId));
  });
});

describe("hand categories", () => {
  it("identifies each category", () => {
    expect(evalOf("As Ks Qs Js Ts").category).toBe("straight-flush");
    expect(evalOf("9h 9d 9s 9c 2h").category).toBe("quads");
    expect(evalOf("8h 8d 8s 3c 3h").category).toBe("full-house");
    expect(evalOf("Ah 9h 7h 4h 2h").category).toBe("flush");
    expect(evalOf("9h 8d 7s 6c 5h").category).toBe("straight");
    expect(evalOf("Qh Qd Qs 7c 2h").category).toBe("trips");
    expect(evalOf("Jh Jd 4s 4c 9h").category).toBe("two-pair");
    expect(evalOf("Th Td 8s 5c 2h").category).toBe("pair");
    expect(evalOf("Ah Jd 8s 5c 2h").category).toBe("high-card");
  });

  it("labels a royal flush distinctly", () => {
    expect(evalOf("As Ks Qs Js Ts").label).toMatch(/royal/i);
    expect(evalOf("9s 8s 7s 6s 5s").label).not.toMatch(/royal/i);
  });
});

describe("the wheel (A-2-3-4-5)", () => {
  it("is a straight with the five as its high card", () => {
    const wheel = evalOf("Ah 2d 3s 4c 5h");
    expect(wheel.category).toBe("straight");
    expect(wheel.tiebreak).toEqual([5]);
  });

  it("loses to a six-high straight", () => {
    expect(compareHands(evalOf("Ah 2d 3s 4c 5h"), evalOf("6h 2d 3s 4c 5h"))).toBeLessThan(0);
  });

  it("works as a straight flush too", () => {
    const steel = evalOf("Ah 2h 3h 4h 5h");
    expect(steel.category).toBe("straight-flush");
    expect(steel.tiebreak).toEqual([5]);
    // ...and loses to any higher straight flush.
    expect(compareHands(steel, evalOf("6s 2s 3s 4s 5s"))).toBeLessThan(0);
  });

  it("is not fooled into A-K-Q-J-T wrapping round to 2", () => {
    // K-A-2-3-4 is NOT a straight.
    expect(evalOf("Kh Ad 2s 3c 4h").category).toBe("high-card");
  });
});

describe("seven-card evaluation (hole + board)", () => {
  it("picks the best five from seven", () => {
    // Board pairs the board; player holds the nut flush.
    const value = evalOf("As Ks 7s 4s 2s 9h 9d");
    expect(value.category).toBe("flush");
    expect(value.cards).toHaveLength(5);
    expect(value.cards.every((c) => c.suit === "s")).toBe(true);
  });

  it("ranks a full house above a flush", () => {
    // Note these cannot co-exist in one 7-card hand: a full house needs at
    // least three off-suit cards, so a flush would require an eighth card.
    expect(compareHands(evalOf("8h 8d 8s 3c 3h"), evalOf("Ah 9h 7h 4h 2h"))).toBeGreaterThan(0);
  });

  it("prefers trips over a four-card flush draw", () => {
    const value = evalOf("As Ks 7s 4s 2h Ah Ad");
    expect(value.category).toBe("trips");
    expect(value.tiebreak[0]).toBe(14);
  });

  it("finds a straight spanning hole and board", () => {
    const value = evalOf("7h 8d 9s Tc Jh 2s 3d");
    expect(value.category).toBe("straight");
    expect(value.tiebreak).toEqual([11]);
  });

  it("always returns exactly five cards", () => {
    for (const spec of [
      "As Ks Qs Js Ts 2h 3d",
      "2h 3d 4s 5c 7h 9d Jc",
      "Ah Ad Ac As Kh Kd Qc",
    ]) {
      expect(evalOf(spec).cards).toHaveLength(5);
    }
  });
});

describe("tie-breaking", () => {
  it("compares kickers on equal pairs", () => {
    const better = evalOf("Kh Kd Ah 7s 3c");
    const worse = evalOf("Ks Kc Qh 7d 3h");
    expect(compareHands(better, worse)).toBeGreaterThan(0);
  });

  it("treats identical hands of different suits as a genuine tie", () => {
    expect(compareHands(evalOf("Kh Kd 9h 7s 3c"), evalOf("Ks Kc 9d 7d 3h"))).toBe(0);
  });

  it("ranks two pair by the higher pair first, then the lower, then kicker", () => {
    expect(compareHands(evalOf("Ah Ad 2s 2c Kh"), evalOf("Kh Kd Qs Qc Ah"))).toBeGreaterThan(0);
    expect(compareHands(evalOf("Ah Ad 5s 5c 3h"), evalOf("As Ac 4s 4c Kh"))).toBeGreaterThan(0);
    expect(compareHands(evalOf("Ah Ad 5s 5c Kh"), evalOf("As Ac 5h 5d Qc"))).toBeGreaterThan(0);
  });

  it("ranks full houses by the trips first", () => {
    expect(compareHands(evalOf("2h 2d 2s Ah Ad"), evalOf("Ah Ac As 2c 2h"))).toBeLessThan(0);
  });

  it("compares flushes card by card", () => {
    expect(compareHands(evalOf("Ah Qh 9h 5h 3h"), evalOf("Ad Qd 9d 5d 2d"))).toBeGreaterThan(0);
  });

  it("orders the categories correctly end to end", () => {
    const ordered = [
      evalOf("Ah Jd 8s 5c 2h"),
      evalOf("Th Td 8s 5c 2h"),
      evalOf("Jh Jd 4s 4c 9h"),
      evalOf("Qh Qd Qs 7c 2h"),
      evalOf("9h 8d 7s 6c 5h"),
      evalOf("Ah 9h 7h 4h 2h"),
      evalOf("8h 8d 8s 3c 3h"),
      evalOf("9h 9d 9s 9c 2h"),
      evalOf("As Ks Qs Js Ts"),
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(compareHands(ordered[i]!, ordered[i - 1]!)).toBeGreaterThan(0);
    }
  });
});

describe("evaluator robustness", () => {
  it("refuses fewer than five cards", () => {
    expect(() => evaluateHand(hand("Ah Kh Qh Jh"))).toThrow();
  });

  it("never crashes on any 7-card sample from a shuffled deck", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const { deck } = shuffleDeck(buildDeck(), seed);
      const value = evaluateHand(deck.slice(0, 7));
      expect(value.cards).toHaveLength(5);
      expect(value.tiebreak.length).toBeGreaterThan(0);
    }
  });

  it("produces a plausible category distribution over many deals", () => {
    // Sanity check against known frequencies: high card and pair should
    // dominate, straight flushes should be rare.
    const counts = new Map<string, number>();
    let state = 7;
    for (let i = 0; i < 4000; i++) {
      const shuffled = shuffleDeck(buildDeck(), state);
      state = shuffled.rngState;
      const cat = evaluateHand(shuffled.deck.slice(0, 7)).category;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    const pairish = (counts.get("pair") ?? 0) + (counts.get("two-pair") ?? 0) + (counts.get("high-card") ?? 0);
    expect(pairish).toBeGreaterThan(2000);
    expect(counts.get("straight-flush") ?? 0).toBeLessThan(120);
  });
});
