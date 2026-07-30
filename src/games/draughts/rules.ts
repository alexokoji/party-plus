/**
 * Draughts variants.
 *
 * The family is wide — English draughts, international, Spanish, Russian —
 * and the differences are mostly a handful of booleans, so they live in a
 * rules object rather than being baked into the engine.
 */

export const BOARD = 8;

export interface DraughtsRules {
  id: string;
  name: string;
  description: string;
  /** Captures must be taken when one is available. */
  mandatoryCapture: boolean;
  /**
   * When several captures are available, the one taking the most pieces must
   * be chosen. Off in English draughts, on in international.
   */
  mustTakeMaximum: boolean;
  /** Kings slide any distance along a diagonal, rather than one square. */
  flyingKings: boolean;
  /** Uncrowned men may capture backwards (they still only *move* forward). */
  menCaptureBackwards: boolean;
  /**
   * Reaching the back row ends the turn immediately, even mid-chain. This is
   * the standard English rule: a newly crowned king does not keep jumping.
   */
  promotionEndsTurn: boolean;
}

export const ENGLISH_DRAUGHTS: DraughtsRules = {
  id: "english",
  name: "English Draughts",
  description: "Men move and capture forwards only. Kings step one square. Captures are compulsory.",
  mandatoryCapture: true,
  mustTakeMaximum: false,
  flyingKings: false,
  menCaptureBackwards: false,
  promotionEndsTurn: true,
};

export const INTERNATIONAL_DRAUGHTS: DraughtsRules = {
  id: "international",
  name: "International",
  description: "Men capture backwards, kings fly along diagonals, and you must take the maximum.",
  mandatoryCapture: true,
  mustTakeMaximum: true,
  flyingKings: true,
  menCaptureBackwards: true,
  promotionEndsTurn: true,
};

export const CASUAL_DRAUGHTS: DraughtsRules = {
  id: "casual",
  name: "Casual",
  description: "Captures are optional — friendlier for beginners, and no forced-jump surprises.",
  mandatoryCapture: false,
  mustTakeMaximum: false,
  flyingKings: false,
  menCaptureBackwards: false,
  promotionEndsTurn: true,
};

export const DRAUGHTS_VARIANTS: DraughtsRules[] = [
  ENGLISH_DRAUGHTS,
  INTERNATIONAL_DRAUGHTS,
  CASUAL_DRAUGHTS,
];

export function getDraughtsVariant(id: string | undefined): DraughtsRules {
  return DRAUGHTS_VARIANTS.find((v) => v.id === id) ?? ENGLISH_DRAUGHTS;
}

/** Only dark squares are playable, and they are the ones where (r+c) is odd. */
export function isPlayableSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

export function onBoard(row: number, col: number): boolean {
  return row >= 0 && row < BOARD && col >= 0 && col < BOARD;
}
