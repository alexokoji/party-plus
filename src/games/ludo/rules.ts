/**
 * Ludo board geometry and rule options.
 *
 * Board model: one shared 52-square track, plus a private 5-square home
 * column per player. A pawn's `progress` is measured from its own entry
 * square, which keeps every player's journey identical in length and makes
 * the colour-relative maths trivial:
 *
 *   progress 0..51  → on the shared track, at absolute square (entry + progress) % 52
 *   progress 52..56 → in that player's home column (5 squares)
 *   progress 57     → home
 */

export const TRACK_LENGTH = 52;
export const HOME_COLUMN_LENGTH = 5;
/** Progress value meaning "finished". */
export const HOME_PROGRESS = TRACK_LENGTH + HOME_COLUMN_LENGTH; // 57
export const PAWNS_PER_PLAYER = 4;

export type LudoColor = "red" | "green" | "yellow" | "blue";

export const COLORS: LudoColor[] = ["red", "green", "yellow", "blue"];

/** Entry square on the shared track for each seat, evenly spaced. */
export const ENTRY_SQUARES = [0, 13, 26, 39];

/**
 * Squares nobody can be captured on. These are the four entry squares plus
 * the four starred squares eight steps along from each — the standard eight
 * safe squares on a Ludo board.
 */
export const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export interface LudoRules {
  id: string;
  name: string;
  description: string;
  /** Roll needed to bring a pawn out of its base. */
  exitRoll: number;
  /** Rolling this grants another turn. */
  extraTurnRoll: number;
  /** Three of these in a row forfeits the turn, to stop endless rolling. */
  maxConsecutiveExtraTurns: number;
  /** A pawn must land exactly on home; an overshoot is not a legal move. */
  requireExactFinish: boolean;
  /** Capturing an opponent grants another turn. */
  extraTurnOnCapture: boolean;
  /** Two pawns of one colour on a square block opponents from passing. */
  blockingEnabled: boolean;
  /** Pawns are safe from capture on the marked squares. */
  safeSquaresEnabled: boolean;
  /**
   * When a roll leaves exactly one legal move, play it automatically.
   *
   * There is no decision to make, and forcing a second click just delays the
   * handoff to the next player for no gain.
   */
  autoMoveWhenForced: boolean;
}

export const CLASSIC_LUDO: LudoRules = {
  id: "classic",
  name: "Classic",
  description: "Roll 6 to leave base and roll again. Safe squares protect. Exact roll to finish.",
  exitRoll: 6,
  extraTurnRoll: 6,
  maxConsecutiveExtraTurns: 3,
  requireExactFinish: true,
  extraTurnOnCapture: true,
  blockingEnabled: false,
  safeSquaresEnabled: true,
  autoMoveWhenForced: true,
};

export const QUICK_LUDO: LudoRules = {
  ...CLASSIC_LUDO,
  id: "quick",
  name: "Quick",
  description: "Leave base on a 1 or a 6, and overshooting still gets a pawn home.",
  exitRoll: 6,
  requireExactFinish: false,
};

export const CUTTHROAT_LUDO: LudoRules = {
  ...CLASSIC_LUDO,
  id: "cutthroat",
  name: "Cutthroat",
  description: "No safe squares — anyone can be sent home from anywhere on the track.",
  safeSquaresEnabled: false,
};

export const LUDO_VARIANTS: LudoRules[] = [CLASSIC_LUDO, QUICK_LUDO, CUTTHROAT_LUDO];

export function getLudoVariant(id: string | undefined): LudoRules {
  return LUDO_VARIANTS.find((v) => v.id === id) ?? CLASSIC_LUDO;
}

/** Absolute square a pawn occupies, or null when it is off the shared track. */
export function absoluteSquare(seatIndex: number, progress: number): number | null {
  if (progress < 0 || progress >= TRACK_LENGTH) return null;
  return (ENTRY_SQUARES[seatIndex]! + progress) % TRACK_LENGTH;
}

export function isSafeSquare(square: number, rules: LudoRules): boolean {
  return rules.safeSquaresEnabled && SAFE_SQUARES.has(square);
}

/* ------------------------------------------------------------------ *
 * Board geometry — the real cross-shaped 15×15 Ludo board.
 *
 * A physical Ludo board is a plus/cross: four 6×6 corner bases, three-wide
 * arms, colour-coded home columns running into a central home, and a 52-cell
 * track that snakes around the arms. These coordinates live here rather than
 * in the renderer so they can be unit-tested — an off-by-one in the path
 * would put pawns through walls.
 *
 * Grid is 0-indexed [x, y], x rightwards and y downwards.
 * ------------------------------------------------------------------ */

export const GRID = 15;

export type Coord = readonly [number, number];

/**
 * The 52 track cells in play order, starting at seat 0's entry square.
 *
 * Built segment by segment around the cross so the ordering is auditable:
 * five along the left arm, up the left side of the top arm, over the tip,
 * back down, and so on round the board.
 */
export const TRACK_COORDS: Coord[] = [
  // left arm, heading right toward the top arm
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  // up the left edge of the top arm
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  // across the tip
  [7, 0],
  // down the right edge of the top arm
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  // right arm, heading out
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7],
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  // down the right edge of the bottom arm
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14],
  // up the left edge of the bottom arm
  [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  // left arm, heading back to the start
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7],
  [0, 6],
];

/** Each seat's five home-column cells, running inward toward the centre. */
export const HOME_COLUMN_COORDS: Coord[][] = [
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]], // seat 0 — from the left
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]], // seat 1 — from the top
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]], // seat 2 — from the right
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]], // seat 3 — from the bottom
];

/** Corner base areas as [x, y, width, height], each adjacent to its entry. */
export const BASE_RECTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 6, 6], // seat 0 — top-left
  [9, 0, 6, 6], // seat 1 — top-right
  [9, 9, 6, 6], // seat 2 — bottom-right
  [0, 9, 6, 6], // seat 3 — bottom-left
];

/** Where the four pawns sit inside a base rect, as grid offsets. */
export const BASE_SLOTS: Coord[] = [
  [1, 1],
  [3, 1],
  [1, 3],
  [3, 3],
];
