/**
 * Snakes & Ladders boards.
 *
 * The board is data, not code: a variant is just a map of square → destination
 * plus a couple of toggles, so shipping a new board means adding an entry here.
 */

export const BOARD_SIZE = 100;

export interface SnakesRules {
  id: string;
  name: string;
  description: string;
  /** Ladder base → top. Every value must be higher than its key. */
  ladders: Record<number, number>;
  /** Snake head → tail. Every value must be lower than its key. */
  snakes: Record<number, number>;
  /** A roll overshooting 100 does not move; you must land exactly. */
  requireExactFinish: boolean;
  /** Rolling this grants another turn. Null disables. */
  extraTurnRoll: number | null;
  /** Consecutive extra turns before the turn is forfeited. */
  maxConsecutiveExtras: number;
}

/**
 * The traditional board.
 *
 * Nine ladders and ten snakes — deliberately snake-heavy, and arranged so no
 * ladder top lands on a snake head (validateBoard enforces that).
 */
export const CLASSIC_BOARD: SnakesRules = {
  id: "classic",
  name: "Classic",
  description: "The traditional board: ten ladders, ten snakes, exact roll to finish.",
  ladders: { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 },
  snakes: { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 },
  requireExactFinish: true,
  extraTurnRoll: 6,
  maxConsecutiveExtras: 3,
};

/** Fewer, gentler hazards — noticeably quicker to finish. */
export const SHORT_BOARD: SnakesRules = {
  id: "short",
  name: "Quick Climb",
  description: "Ladder-heavy board with only a few short snakes, and overshooting still wins.",
  ladders: { 3: 22, 8: 30, 15: 44, 28: 59, 40: 76, 54: 88, 71: 92 },
  snakes: { 37: 27, 52: 35, 66: 49, 83: 68, 97: 79 },
  requireExactFinish: false,
  extraTurnRoll: 6,
  maxConsecutiveExtras: 3,
};

/** Brutal: long snakes near the top, and you must land exactly on 100. */
export const CRUEL_BOARD: SnakesRules = {
  id: "cruel",
  name: "Cruel",
  description: "Long snakes guarding the finish. Exact roll required, and no extra turns.",
  ladders: { 2: 23, 11: 37, 26: 48, 45: 63, 58: 77 },
  snakes: { 33: 5, 61: 18, 74: 31, 88: 24, 92: 51, 96: 42, 99: 12 },
  requireExactFinish: true,
  extraTurnRoll: null,
  maxConsecutiveExtras: 1,
};

export const SNAKES_VARIANTS: SnakesRules[] = [CLASSIC_BOARD, SHORT_BOARD, CRUEL_BOARD];

export function getSnakesVariant(id: string | undefined): SnakesRules {
  return SNAKES_VARIANTS.find((v) => v.id === id) ?? CLASSIC_BOARD;
}

/** Where a square sends you, or null if it is an ordinary square. */
export function destinationOf(square: number, rules: SnakesRules): number | null {
  return rules.ladders[square] ?? rules.snakes[square] ?? null;
}

/**
 * Validates a board's shape.
 *
 * Exported so variant definitions can be checked in tests: a ladder that goes
 * down, or a snake sharing a square with a ladder, would make the board behave
 * nonsensically rather than merely differently.
 */
export function validateBoard(rules: SnakesRules): string[] {
  const problems: string[] = [];

  for (const [from, to] of Object.entries(rules.ladders)) {
    const base = Number(from);
    if (to <= base) problems.push(`ladder ${base}→${to} does not go up`);
    if (to > BOARD_SIZE) problems.push(`ladder ${base}→${to} leaves the board`);
    if (base >= BOARD_SIZE) problems.push(`ladder base ${base} is at or past the finish`);
  }

  for (const [from, to] of Object.entries(rules.snakes)) {
    const head = Number(from);
    if (to >= head) problems.push(`snake ${head}→${to} does not go down`);
    if (to < 1) problems.push(`snake ${head}→${to} leaves the board`);
    if (head >= BOARD_SIZE) problems.push(`snake head ${head} is at or past the finish`);
  }

  for (const square of Object.keys(rules.ladders)) {
    if (square in rules.snakes) problems.push(`square ${square} is both a ladder and a snake`);
  }

  // A chain (landing on a ladder that drops you onto a snake head) is legal in
  // some houses but confusing; flag it so a board author makes it deliberate.
  for (const to of Object.values(rules.ladders)) {
    if (to in rules.snakes) problems.push(`ladder top ${to} is a snake head (chains)`);
  }
  for (const to of Object.values(rules.snakes)) {
    if (to in rules.ladders) problems.push(`snake tail ${to} is a ladder base (chains)`);
  }

  return problems;
}
