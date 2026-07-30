import { nextRandom } from "../../engine/rng";

export type Suit = "s" | "h" | "d" | "c";
/** 2..14, where 11=J, 12=Q, 13=K, 14=A. */
export type Rank = number;

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const SUITS: Suit[] = ["s", "h", "d", "c"];
export const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_LABEL: Record<number, string> = {
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

export const SUIT_GLYPH: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export function cardLabel(card: Card): string {
  return `${RANK_LABEL[card.rank] ?? card.rank}${SUIT_GLYPH[card.suit]}`;
}

export function cardId(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

/** Fisher–Yates against a serialisable PRNG state. */
export function shuffleDeck(deck: Card[], rngState: number): { deck: Card[]; rngState: number } {
  const out = [...deck];
  let state = rngState;
  for (let i = out.length - 1; i > 0; i--) {
    const next = nextRandom(state);
    state = next.state;
    const j = Math.floor(next.value * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return { deck: out, rngState: state };
}

export type HandCategory =
  | "high-card"
  | "pair"
  | "two-pair"
  | "trips"
  | "straight"
  | "flush"
  | "full-house"
  | "quads"
  | "straight-flush";

/** Higher is better. Used as the primary comparison key. */
export const CATEGORY_RANK: Record<HandCategory, number> = {
  "high-card": 0,
  pair: 1,
  "two-pair": 2,
  trips: 3,
  straight: 4,
  flush: 5,
  "full-house": 6,
  quads: 7,
  "straight-flush": 8,
};

export interface HandValue {
  category: HandCategory;
  /**
   * Tie-breakers in descending significance. Two hands of the same category
   * are compared element by element; equal arrays mean a genuine tie (a split
   * pot), which is why kickers must be included here in full.
   */
  tiebreak: number[];
  /** The exact five cards that make the hand, for display. */
  cards: Card[];
  label: string;
}

const CATEGORY_LABEL: Record<HandCategory, string> = {
  "high-card": "High card",
  pair: "Pair",
  "two-pair": "Two pair",
  trips: "Three of a kind",
  straight: "Straight",
  flush: "Flush",
  "full-house": "Full house",
  quads: "Four of a kind",
  "straight-flush": "Straight flush",
};

/**
 * Best straight present in a set of ranks, returned as its high card.
 *
 * Handles the wheel (A-2-3-4-5), where the ace plays low and the straight's
 * high card is the five — the single most commonly botched case in a poker
 * evaluator.
 */
function bestStraightHigh(ranks: number[]): number | null {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  // Ace doubles as 1 for the wheel.
  if (unique.includes(14)) unique.push(1);

  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] === unique[i - 1]! - 1) {
      run++;
      // The run spans indices i-4..i (descending), so its high card is at
      // i-4. Using i-3 here reports every straight one rank too low, which
      // then makes pickStraightCards come up a card short.
      if (run >= 5) return unique[i - 4]!;
    } else {
      run = 1;
    }
  }
  return null;
}

function cardsOfRank(cards: Card[], rank: number): Card[] {
  return cards.filter((c) => c.rank === rank);
}

/**
 * Evaluates the best five-card hand from five to seven cards.
 *
 * Works by category from strongest down, so the first match is always the
 * best available hand.
 */
export function evaluateHand(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error("need at least 5 cards to evaluate");

  const bySuit = new Map<Suit, Card[]>();
  for (const card of cards) {
    const list = bySuit.get(card.suit) ?? [];
    list.push(card);
    bySuit.set(card.suit, list);
  }
  const flushSuit = [...bySuit.entries()].find(([, list]) => list.length >= 5)?.[0] ?? null;

  // --- straight flush ---
  if (flushSuit) {
    const suited = bySuit.get(flushSuit)!;
    const high = bestStraightHigh(suited.map((c) => c.rank));
    if (high !== null) {
      const picked = pickStraightCards(suited, high);
      return {
        category: "straight-flush",
        tiebreak: [high],
        cards: picked,
        label: high === 14 ? "Royal flush" : `${CATEGORY_LABEL["straight-flush"]}, ${rankName(high)} high`,
      };
    }
  }

  // Rank multiplicities, highest count then highest rank.
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const quad = grouped.find(([, n]) => n === 4)?.[0];
  const trips = grouped.filter(([, n]) => n === 3).map(([r]) => r);
  const pairs = grouped.filter(([, n]) => n === 2).map(([r]) => r);

  // --- four of a kind ---
  if (quad !== undefined) {
    const kicker = cards.filter((c) => c.rank !== quad).sort((a, b) => b.rank - a.rank)[0]!;
    return {
      category: "quads",
      tiebreak: [quad, kicker.rank],
      cards: [...cardsOfRank(cards, quad).slice(0, 4), kicker],
      label: `${CATEGORY_LABEL.quads}, ${rankName(quad)}s`,
    };
  }

  // --- full house (also covers two sets of trips) ---
  if (trips.length >= 1 && (trips.length >= 2 || pairs.length >= 1)) {
    const three = trips[0]!;
    const pairRank = trips.length >= 2 ? trips[1]! : pairs[0]!;
    return {
      category: "full-house",
      tiebreak: [three, pairRank],
      cards: [...cardsOfRank(cards, three).slice(0, 3), ...cardsOfRank(cards, pairRank).slice(0, 2)],
      label: `${CATEGORY_LABEL["full-house"]}, ${rankName(three)}s over ${rankName(pairRank)}s`,
    };
  }

  // --- flush ---
  if (flushSuit) {
    const suited = bySuit.get(flushSuit)!.sort((a, b) => b.rank - a.rank).slice(0, 5);
    return {
      category: "flush",
      tiebreak: suited.map((c) => c.rank),
      cards: suited,
      label: `${CATEGORY_LABEL.flush}, ${rankName(suited[0]!.rank)} high`,
    };
  }

  // --- straight ---
  const straightHigh = bestStraightHigh(cards.map((c) => c.rank));
  if (straightHigh !== null) {
    return {
      category: "straight",
      tiebreak: [straightHigh],
      cards: pickStraightCards(cards, straightHigh),
      label: `${CATEGORY_LABEL.straight}, ${rankName(straightHigh)} high`,
    };
  }

  // --- trips ---
  if (trips.length === 1) {
    const three = trips[0]!;
    const kickers = cards.filter((c) => c.rank !== three).sort((a, b) => b.rank - a.rank).slice(0, 2);
    return {
      category: "trips",
      tiebreak: [three, ...kickers.map((c) => c.rank)],
      cards: [...cardsOfRank(cards, three).slice(0, 3), ...kickers],
      label: `${CATEGORY_LABEL.trips}, ${rankName(three)}s`,
    };
  }

  // --- two pair ---
  if (pairs.length >= 2) {
    const [high, low] = [pairs[0]!, pairs[1]!];
    const kicker = cards.filter((c) => c.rank !== high && c.rank !== low).sort((a, b) => b.rank - a.rank)[0]!;
    return {
      category: "two-pair",
      tiebreak: [high, low, kicker.rank],
      cards: [...cardsOfRank(cards, high).slice(0, 2), ...cardsOfRank(cards, low).slice(0, 2), kicker],
      label: `${CATEGORY_LABEL["two-pair"]}, ${rankName(high)}s and ${rankName(low)}s`,
    };
  }

  // --- one pair ---
  if (pairs.length === 1) {
    const pair = pairs[0]!;
    const kickers = cards.filter((c) => c.rank !== pair).sort((a, b) => b.rank - a.rank).slice(0, 3);
    return {
      category: "pair",
      tiebreak: [pair, ...kickers.map((c) => c.rank)],
      cards: [...cardsOfRank(cards, pair).slice(0, 2), ...kickers],
      label: `${CATEGORY_LABEL.pair} of ${rankName(pair)}s`,
    };
  }

  // --- high card ---
  const top = [...cards].sort((a, b) => b.rank - a.rank).slice(0, 5);
  return {
    category: "high-card",
    tiebreak: top.map((c) => c.rank),
    cards: top,
    label: `${CATEGORY_LABEL["high-card"]}, ${rankName(top[0]!.rank)}`,
  };
}

/** Picks the five cards forming a straight ending at `high`. */
function pickStraightCards(cards: Card[], high: number): Card[] {
  const wanted = high === 5 ? [5, 4, 3, 2, 14] : [high, high - 1, high - 2, high - 3, high - 4];
  const out: Card[] = [];
  for (const rank of wanted) {
    const card = cards.find((c) => c.rank === rank && !out.includes(c));
    if (card) out.push(card);
  }
  return out;
}

export function rankName(rank: number): string {
  return RANK_LABEL[rank] ?? String(rank);
}

/** Negative if a < b, positive if a > b, zero for a genuine tie. */
export function compareHands(a: HandValue, b: HandValue): number {
  const byCategory = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
  if (byCategory !== 0) return byCategory;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
    const diff = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
