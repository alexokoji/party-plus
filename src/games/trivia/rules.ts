/**
 * Trivia formats.
 *
 * Content lives in packs (see src/content); this file is only about pace and
 * scoring. Scoring is speed-weighted: a correct answer is worth `basePoints`
 * plus up to `speedPoints` more, scaled by how much of the clock was left.
 */

export interface TriviaRules {
  id: string;
  name: string;
  description: string;
  /** Questions in a match. Trimmed to the pack size if the pack is smaller. */
  questionCount: number;
  secondsPerQuestion: number;
  /** How long the answer stays on screen with the leaderboard. */
  revealSeconds: number;
  basePoints: number;
  speedPoints: number;
  /** Points lost for a wrong answer. Zero in the friendly formats. */
  wrongPenalty: number;
}

export const CLASSIC_TRIVIA: TriviaRules = {
  id: "classic",
  name: "Classic",
  description: "10 questions, 20 seconds each. Faster correct answers score more.",
  questionCount: 10,
  secondsPerQuestion: 20,
  revealSeconds: 6,
  basePoints: 500,
  speedPoints: 500,
  wrongPenalty: 0,
};

export const BLITZ_TRIVIA: TriviaRules = {
  ...CLASSIC_TRIVIA,
  id: "blitz",
  name: "Blitz",
  description: "15 questions at 10 seconds. Almost all the points are in the speed.",
  questionCount: 15,
  secondsPerQuestion: 10,
  revealSeconds: 4,
  basePoints: 300,
  speedPoints: 700,
};

export const MARATHON_TRIVIA: TriviaRules = {
  ...CLASSIC_TRIVIA,
  id: "marathon",
  name: "Marathon",
  description: "20 questions, 30 seconds, and a penalty for guessing wildly.",
  questionCount: 20,
  secondsPerQuestion: 30,
  revealSeconds: 6,
  wrongPenalty: 100,
};

export const TRIVIA_VARIANTS: TriviaRules[] = [CLASSIC_TRIVIA, BLITZ_TRIVIA, MARATHON_TRIVIA];

export function getTriviaVariant(id: string | undefined): TriviaRules {
  return TRIVIA_VARIANTS.find((v) => v.id === id) ?? CLASSIC_TRIVIA;
}

/**
 * Points for a correct answer, given how long it took.
 *
 * Answering instantly is worth base + speed; answering as the clock dies is
 * worth the base alone. Never negative, and never more than the maximum, so a
 * clock skew on the client cannot mint points.
 */
export function scoreAnswer(rules: TriviaRules, elapsedMs: number): number {
  const limit = rules.secondsPerQuestion * 1000;
  const fraction = Math.max(0, Math.min(1, 1 - elapsedMs / limit));
  return rules.basePoints + Math.round(rules.speedPoints * fraction);
}
