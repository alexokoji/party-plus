/**
 * Sketch & Guess: pace and scoring.
 *
 * Guessers are paid for speed; the drawer is paid for how many people got it,
 * which is what stops a drawer choosing the hardest word every time and
 * scribbling something nobody can read.
 */

export interface SketchRules {
  id: string;
  name: string;
  description: string;
  /** Full cycles of the table — everyone draws once per round. */
  rounds: number;
  drawSeconds: number;
  /** Seconds the drawer has to pick from the offered words. */
  chooseSeconds: number;
  /** Seconds the word and scores stay up between turns. */
  betweenSeconds: number;
  /** Words offered to the drawer to pick from. */
  wordChoices: number;
  /** Points for the first correct guess, decaying to `minGuessPoints`. */
  maxGuessPoints: number;
  minGuessPoints: number;
  /** Points the drawer gets per person who guessed it. */
  drawerPointsPerGuess: number;
  /** Reveals a letter of the word when this fraction of the clock is left. */
  hintAt: number[];
}

export const CLASSIC_SKETCH: SketchRules = {
  id: "classic",
  name: "Classic",
  description: "3 rounds, 80 seconds a drawing, two letter hints along the way.",
  rounds: 3,
  drawSeconds: 80,
  chooseSeconds: 15,
  betweenSeconds: 8,
  wordChoices: 3,
  maxGuessPoints: 500,
  minGuessPoints: 100,
  drawerPointsPerGuess: 150,
  hintAt: [0.6, 0.3],
};

export const QUICK_SKETCH: SketchRules = {
  ...CLASSIC_SKETCH,
  id: "quick",
  name: "Quick",
  description: "2 rounds at 45 seconds. One hint, and no time to be precious.",
  rounds: 2,
  drawSeconds: 45,
  chooseSeconds: 10,
  betweenSeconds: 5,
  hintAt: [0.4],
};

export const MARATHON_SKETCH: SketchRules = {
  ...CLASSIC_SKETCH,
  id: "marathon",
  name: "Marathon",
  description: "5 rounds, 100 seconds, four words to choose from. Settle in.",
  rounds: 5,
  drawSeconds: 100,
  wordChoices: 4,
  hintAt: [0.6, 0.4, 0.2],
};

export const SKETCH_VARIANTS: SketchRules[] = [CLASSIC_SKETCH, QUICK_SKETCH, MARATHON_SKETCH];

export function getSketchVariant(id: string | undefined): SketchRules {
  return SKETCH_VARIANTS.find((v) => v.id === id) ?? CLASSIC_SKETCH;
}

/**
 * Points for a correct guess.
 *
 * `place` is 0 for the first person to get it. Later guessers earn less, but
 * never less than the floor — being fourth is still worth playing for.
 */
export function scoreGuess(rules: SketchRules, place: number, msLeft: number, totalMs: number): number {
  const speed = Math.max(0, Math.min(1, msLeft / Math.max(1, totalMs)));
  const placePenalty = Math.max(0, 1 - place * 0.15);
  const range = rules.maxGuessPoints - rules.minGuessPoints;
  return rules.minGuessPoints + Math.round(range * speed * placePenalty);
}

/**
 * Comparison form for guesses.
 *
 * Punctuation, spacing and case are noise — "moi-moi", "Moi Moi" and "moimoi"
 * are the same answer, and refusing them makes the game feel broken.
 */
export function normalizeGuess(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Edit distance, capped — used only to tell someone they are close. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
    if (Math.min(...row) > cap) return cap + 1;
  }
  return prev[b.length]!;
}

/**
 * The word with all but `revealed` letters masked.
 *
 * Spaces and punctuation are shown from the start: the shape of the phrase is
 * not the secret, the letters are.
 */
export function maskWord(word: string, revealedIndexes: number[]): string {
  const show = new Set(revealedIndexes);
  return word
    .split("")
    .map((ch, i) => (/[a-zA-Z0-9]/.test(ch) ? (show.has(i) ? ch : "_") : ch))
    .join("");
}
