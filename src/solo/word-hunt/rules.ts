/**
 * Word Hunt: guess the hidden word, one letter of feedback at a time.
 *
 * The rules live apart from the component so they can be tested without a
 * browser — the scoring of a guess is the entire game, and getting it subtly
 * wrong (the classic being repeated letters) is the difference between a
 * puzzle and an argument.
 */

export type LetterMark = "right" | "moved" | "absent";

export interface Guess {
  word: string;
  marks: LetterMark[];
}

export const MAX_ATTEMPTS = 6;

/**
 * Scores a guess against the answer.
 *
 * Repeated letters are the part everyone gets wrong. A letter is only "moved"
 * if the answer still has an unaccounted copy of it, so guessing OKOKO against
 * OKADA marks exactly one O and one K, not every one of them. Exact matches
 * are claimed first, in a separate pass, or an earlier duplicate would steal
 * the credit belonging to a letter in its right place.
 */
export function scoreGuess(guess: string, answer: string): LetterMark[] {
  const g = guess.toUpperCase();
  const a = answer.toUpperCase();
  const marks: LetterMark[] = Array(g.length).fill("absent");

  const remaining = new Map<string, number>();
  for (let i = 0; i < a.length; i++) {
    if (g[i] === a[i]) {
      marks[i] = "right";
    } else {
      remaining.set(a[i]!, (remaining.get(a[i]!) ?? 0) + 1);
    }
  }

  for (let i = 0; i < g.length; i++) {
    if (marks[i] === "right") continue;
    const left = remaining.get(g[i]!) ?? 0;
    if (left > 0) {
      marks[i] = "moved";
      remaining.set(g[i]!, left - 1);
    }
  }

  return marks;
}

export const isWin = (marks: LetterMark[]): boolean => marks.every((m) => m === "right");

/**
 * Letters ruled out so far, for the on-screen keyboard.
 *
 * "right" beats "moved" beats "absent": a letter that was once absent in one
 * position can still be right in another, so the best mark it has ever earned
 * is the one shown.
 */
export function letterStates(guesses: Guess[]): Record<string, LetterMark> {
  const rank: Record<LetterMark, number> = { absent: 0, moved: 1, right: 2 };
  const best: Record<string, LetterMark> = {};
  for (const guess of guesses) {
    guess.word.split("").forEach((letter, i) => {
      const mark = guess.marks[i]!;
      const current = best[letter];
      if (!current || rank[mark] > rank[current]) best[letter] = mark;
    });
  }
  return best;
}

/** Points for solving, weighted to the attempts left. */
export function scoreFor(attemptsUsed: number): number {
  return Math.max(100, 1000 - (attemptsUsed - 1) * 150);
}

/**
 * Words a round can use.
 *
 * Single words only, letters only, and a length that makes a fair puzzle —
 * the packs are written for a word grid where "PORT HARCOURT" is fine, and it
 * is not fine here.
 */
export function playableWords(words: string[], length: number): string[] {
  const seen = new Set<string>();
  return words
    .map((word) => word.trim().toUpperCase())
    .filter((word) => {
      if (word.length !== length || !/^[A-Z]+$/.test(word)) return false;
      if (seen.has(word)) return false;
      seen.add(word);
      return true;
    });
}
