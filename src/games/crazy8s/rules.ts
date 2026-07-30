/**
 * Crazy Eights rule variants.
 *
 * The shedding engine is identical across this whole family — Crazy Eights,
 * Nigerian "Last Card", Uno-style house rules — so nothing is hard-coded and
 * a room picks a config instead of the module picking a dialect.
 *
 * Ranks use the same numbering as the poker deck: 11=J, 12=Q, 13=K, 14=A.
 */

export const JACK = 11;
export const QUEEN = 12;
export const KING = 13;
export const ACE = 14;

export interface Crazy8sRules {
  id: string;
  name: string;
  description: string;
  /** Cards dealt to each player. */
  handSize: number;
  /** Rank that lets the player name the next suit. Null disables wilds. */
  wildRank: number | null;
  /** Rank forcing the next player to draw two. Null disables. */
  drawTwoRank: number | null;
  /** Ranks that skip the next player. */
  skipRanks: number[];
  /** Rank that reverses direction of play. Null disables. */
  reverseRank: number | null;
  /** A draw-two may be answered with another, accumulating the debt. */
  stackDrawTwo: boolean;
  /**
   * A player must announce when down to one card; forgetting costs them a
   * penalty draw when someone calls it.
   */
  mustAnnounceLastCard: boolean;
  /** Cards drawn as a penalty for failing to announce. */
  missedAnnouncementPenalty: number;
  /** Keep drawing until something playable turns up, rather than drawing one. */
  drawUntilPlayable: boolean;
  /** A player holding a playable card may not choose to draw instead. */
  mustPlayIfAble: boolean;
}

export const CLASSIC_CRAZY_EIGHTS: Crazy8sRules = {
  id: "classic",
  name: "Crazy Eights",
  description: "The plain game: 8s are wild, everything else is an ordinary card.",
  handSize: 7,
  wildRank: 8,
  drawTwoRank: null,
  skipRanks: [],
  reverseRank: null,
  stackDrawTwo: false,
  mustAnnounceLastCard: false,
  missedAnnouncementPenalty: 2,
  drawUntilPlayable: true,
  mustPlayIfAble: false,
};

/** Nigerian "Last Card" style: 2 draws two, Jack skips, and you must call it. */
export const LAST_CARD: Crazy8sRules = {
  ...CLASSIC_CRAZY_EIGHTS,
  id: "last-card",
  name: "Last Card",
  description: "2 = pick two (stackable), Jack skips, Ace reverses, and you must call “last card”.",
  handSize: 5,
  drawTwoRank: 2,
  skipRanks: [JACK],
  reverseRank: ACE,
  stackDrawTwo: true,
  mustAnnounceLastCard: true,
  drawUntilPlayable: false,
};

/** Uno-ish: draw-two, skip on Queen, reverse on Ace, announce your last card. */
export const UNO_STYLE: Crazy8sRules = {
  ...CLASSIC_CRAZY_EIGHTS,
  id: "uno-style",
  name: "Uno Style",
  description: "2 = draw two (stackable), Queen skips, Ace reverses, announce your last card.",
  handSize: 7,
  drawTwoRank: 2,
  skipRanks: [QUEEN],
  reverseRank: ACE,
  stackDrawTwo: true,
  mustAnnounceLastCard: true,
  drawUntilPlayable: false,
};

/** Strict: you must play if you can, and you only ever draw one card. */
export const STRICT: Crazy8sRules = {
  ...CLASSIC_CRAZY_EIGHTS,
  id: "strict",
  name: "Strict",
  description: "Draw exactly one card, and you may never pass up a playable card.",
  drawUntilPlayable: false,
  mustPlayIfAble: true,
};

export const CRAZY8S_VARIANTS: Crazy8sRules[] = [
  CLASSIC_CRAZY_EIGHTS,
  LAST_CARD,
  UNO_STYLE,
  STRICT,
];

export function getCrazy8sVariant(id: string | undefined): Crazy8sRules {
  return CRAZY8S_VARIANTS.find((v) => v.id === id) ?? CLASSIC_CRAZY_EIGHTS;
}
