import { mulberry32 } from "../../engine/rng";
import { DECK_WHOT_COUNT, SUIT_NUMBERS, SHAPES, WHOT_NUMBER, type Shape, type WhotRules } from "./rules";

export interface WhotCard {
  /** Stable per-deck identity, so clients can key and animate cards. */
  id: string;
  shape: Shape | "whot";
  number: number;
}

/** Builds a full pack for the given variant. */
export function buildDeck(rules: WhotRules): WhotCard[] {
  const cards: WhotCard[] = [];
  for (const shape of SHAPES) {
    for (const number of SUIT_NUMBERS[shape]) {
      cards.push({ id: `${shape}-${number}`, shape, number });
    }
  }
  const whotCount = DECK_WHOT_COUNT[rules.deck];
  for (let i = 0; i < whotCount; i++) {
    cards.push({ id: `whot-${i}`, shape: "whot", number: WHOT_NUMBER });
  }
  return cards;
}

/** Fisher–Yates with a seeded PRNG, so a match is reproducible from its seed. */
export function shuffle<T>(cards: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Scoring value of a card.
 *
 * Stars count double and Whot counts 20 under the standard rules — both are
 * configurable because house rules vary.
 */
export function cardValue(card: WhotCard, rules: WhotRules): number {
  if (card.shape === "whot") return rules.wildValue;
  if (card.shape === "star" && rules.starsCountDouble) return card.number * 2;
  return card.number;
}

export function handTotal(hand: WhotCard[], rules: WhotRules): number {
  return hand.reduce((sum, card) => sum + cardValue(card, rules), 0);
}

/**
 * Whether `card` may be played on `top`.
 *
 * `requestedShape` is set after a Whot wildcard, and when present it replaces
 * the top card's shape for matching purposes — the named shape is the demand.
 */
export function canPlay(
  card: WhotCard,
  top: WhotCard,
  requestedShape: Shape | null,
  rules: WhotRules
): boolean {
  // A wildcard is always playable (when the variant has one).
  if (card.shape === "whot") return rules.specials.wild !== null;

  if (requestedShape) return card.shape === requestedShape;

  // A Whot on top with no demand recorded would otherwise be unmatchable.
  if (top.shape === "whot") return true;

  return card.shape === top.shape || card.number === top.number;
}

export function describeCard(card: WhotCard): string {
  return card.shape === "whot" ? "Whot 20" : `${card.shape} ${card.number}`;
}
