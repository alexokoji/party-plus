/**
 * Whot rule variants.
 *
 * Whot is played differently across regions and even households, so nothing
 * here is hard-coded into the engine: a room picks a variant and the module
 * reads it. Deck composition and special-card behaviour were checked against
 * pagat.com and Wikipedia (see DECK_SOURCES below) rather than written from
 * memory — several details are easy to get wrong, notably that Stars have no
 * 6 (7 cards, not 8), that a Nigerian pack has 5 Whot cards where a British
 * one has 4, and that Stars score double.
 */

export const DECK_SOURCES = [
  "https://www.pagat.com/com/whot.html",
  "https://en.wikipedia.org/wiki/Whot!",
] as const;

export type Shape = "circle" | "triangle" | "cross" | "square" | "star";

export const SHAPES: Shape[] = ["circle", "triangle", "cross", "square", "star"];

export const SHAPE_GLYPH: Record<Shape, string> = {
  circle: "●",
  triangle: "▲",
  cross: "✚",
  square: "■",
  star: "★",
};

/**
 * Numbers present in each suit. Not every suit carries every number — this is
 * the single most commonly mis-implemented part of Whot.
 */
export const SUIT_NUMBERS: Record<Shape, number[]> = {
  circle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  triangle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  cross: [1, 2, 3, 5, 7, 10, 11, 13, 14],
  square: [1, 2, 3, 5, 7, 10, 11, 13, 14],
  star: [1, 2, 3, 4, 5, 7, 8],
};

export const WHOT_NUMBER = 20;

export type DeckId = "nigerian54" | "british53";

/** Nigerian packs ship 5 Whot cards; British (Waddingtons) packs ship 4. */
export const DECK_WHOT_COUNT: Record<DeckId, number> = {
  nigerian54: 5,
  british53: 4,
};

/**
 * What happens when the market (draw pile) empties.
 *
 * "reshuffle" is the documented standard: the play pile is shuffled back,
 * minus its top card. The other two end the match immediately on hand totals
 * and exist because house rules commonly do that instead.
 */
export type MarketExhaustionRule = "reshuffle" | "lowestTotalWins" | "lowestTotalLoses";

export interface WhotSpecials {
  /** Play again immediately. */
  holdOn: number | null;
  /** Next player draws 2 unless they stack. */
  pickTwo: number | null;
  /** Next player draws 3 unless they stack. */
  pickThree: number | null;
  /** Next player misses their turn. */
  suspension: number | null;
  /** Everyone except the player draws 1. */
  generalMarket: number | null;
  /** Wildcard — the player names a shape. */
  wild: number | null;
}

export interface WhotRules {
  id: string;
  name: string;
  description: string;
  deck: DeckId;
  /** Cards dealt to each player. */
  handSize: number;
  specials: WhotSpecials;
  /** A Pick Two may be answered with another Pick Two, accumulating the debt. */
  stackPickTwo: boolean;
  /** A Pick Three may be answered with another Pick Three. */
  stackPickThree: boolean;
  /**
   * Whether a Pick Three may answer a Pick Two and vice versa. Off by default:
   * most tables treat the two chains as separate.
   */
  crossStacking: boolean;
  /** In some regions a Star 8 suspends two players instead of one. */
  starSuspensionSkipsTwo: boolean;
  /** Stars score double face value. */
  starsCountDouble: boolean;
  /** Score of a Whot card when totalling hands. */
  wildValue: number;
  onMarketExhausted: MarketExhaustionRule;
  /**
   * Whether a player holding a playable card may still choose to draw.
   * Enforcing this needs the server to inspect the hand, which it can do —
   * it holds authoritative state.
   */
  mustPlayIfAble: boolean;
}

/** The default: Nigerian pack, the full set of special cards, stacking on. */
export const CLASSIC_NIGERIAN: WhotRules = {
  id: "classic-nigerian",
  name: "Classic Nigerian",
  description: "54-card pack, Hold On / Pick Two / Pick Three / Suspension / General Market, stacking allowed.",
  deck: "nigerian54",
  handSize: 6,
  specials: { holdOn: 1, pickTwo: 2, pickThree: 5, suspension: 8, generalMarket: 14, wild: WHOT_NUMBER },
  stackPickTwo: true,
  stackPickThree: true,
  crossStacking: false,
  starSuspensionSkipsTwo: false,
  starsCountDouble: true,
  wildValue: 20,
  onMarketExhausted: "reshuffle",
  mustPlayIfAble: false,
};

/** Waddingtons-style British pack: 53 cards, no stacking. */
export const BRITISH_WADDINGTONS: WhotRules = {
  ...CLASSIC_NIGERIAN,
  id: "british-waddingtons",
  name: "British (Waddingtons)",
  description: "53-card pack with 4 Whot cards, no stacking of Pick Two / Pick Three.",
  deck: "british53",
  stackPickTwo: false,
  stackPickThree: false,
};

/**
 * The 1970s–80s Nigerian style described by pagat, where far fewer cards
 * carried special meaning. Kept as a genuine historical variant.
 */
export const OLD_SCHOOL: WhotRules = {
  ...CLASSIC_NIGERIAN,
  id: "old-school",
  name: "Old School",
  description: "Only Hold On and the Whot wildcard are special — everything else is a plain card.",
  specials: { holdOn: 1, pickTwo: null, pickThree: null, suspension: null, generalMarket: null, wild: WHOT_NUMBER },
  stackPickTwo: false,
  stackPickThree: false,
};

/** Ends the match on hand totals when the market runs dry, instead of reshuffling. */
export const SUDDEN_DEATH: WhotRules = {
  ...CLASSIC_NIGERIAN,
  id: "sudden-death",
  name: "Sudden Death",
  description: "As Classic, but when the market runs out the match ends on hand totals.",
  onMarketExhausted: "lowestTotalWins",
};

export const WHOT_VARIANTS: WhotRules[] = [
  CLASSIC_NIGERIAN,
  BRITISH_WADDINGTONS,
  OLD_SCHOOL,
  SUDDEN_DEATH,
];

export function getVariant(id: string | undefined): WhotRules {
  return WHOT_VARIANTS.find((v) => v.id === id) ?? CLASSIC_NIGERIAN;
}
