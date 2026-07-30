/**
 * Code Words: board composition and phase timings.
 *
 * The grid is always 25 cards. The team that goes first gets one extra card,
 * which is what makes the turn order fair — they need one more correct guess
 * to win. The assassin count and the clocks are the levers a variant pulls.
 */

export type Team = "red" | "blue";
export type CardOwner = Team | "neutral" | "assassin";

export interface CodewordsRules {
  id: string;
  name: string;
  description: string;
  /** Always 25 in the shipped variants; the code does not assume it. */
  gridSize: number;
  /** Cards belonging to the team that starts. */
  firstTeamCards: number;
  /** Cards belonging to the team that goes second. */
  secondTeamCards: number;
  assassins: number;
  /** Seconds a spymaster has to give a clue. */
  clueSeconds: number;
  /** Seconds the team has to guess once a clue is on the table. */
  guessSeconds: number;
  /**
   * A clue of 0 means "none of these", and buys unlimited guesses. Off in the
   * gentler variants, where it mostly confuses new players.
   */
  allowZeroClues: boolean;
}

export const CLASSIC_CODEWORDS: CodewordsRules = {
  id: "classic",
  name: "Classic",
  description: "25 words, 9 against 8, one assassin. Generous clocks.",
  gridSize: 25,
  firstTeamCards: 9,
  secondTeamCards: 8,
  assassins: 1,
  clueSeconds: 120,
  guessSeconds: 120,
  allowZeroClues: false,
};

export const QUICK_CODEWORDS: CodewordsRules = {
  ...CLASSIC_CODEWORDS,
  id: "quick",
  name: "Quick",
  description: "Same board, tight clocks. Think fast or lose the turn.",
  clueSeconds: 45,
  guessSeconds: 45,
};

export const DEADLY_CODEWORDS: CodewordsRules = {
  ...CLASSIC_CODEWORDS,
  id: "deadly",
  name: "Deadly",
  description: "Two assassins, fewer neutrals, and zero-clues allowed. Brutal.",
  firstTeamCards: 9,
  secondTeamCards: 8,
  assassins: 2,
  clueSeconds: 90,
  guessSeconds: 60,
  allowZeroClues: true,
};

export const CODEWORDS_VARIANTS: CodewordsRules[] = [
  CLASSIC_CODEWORDS,
  QUICK_CODEWORDS,
  DEADLY_CODEWORDS,
];

export function getCodewordsVariant(id: string | undefined): CodewordsRules {
  return CODEWORDS_VARIANTS.find((v) => v.id === id) ?? CLASSIC_CODEWORDS;
}

/** The owner of every card on a fresh board, before shuffling. */
export function buildKey(rules: CodewordsRules, firstTeam: Team): CardOwner[] {
  const second: Team = firstTeam === "red" ? "blue" : "red";
  const key: CardOwner[] = [
    ...Array<CardOwner>(rules.firstTeamCards).fill(firstTeam),
    ...Array<CardOwner>(rules.secondTeamCards).fill(second),
    ...Array<CardOwner>(rules.assassins).fill("assassin"),
  ];
  const neutrals = rules.gridSize - key.length;
  if (neutrals < 0) throw new Error(`variant ${rules.id} assigns more cards than the grid holds`);
  return [...key, ...Array<CardOwner>(neutrals).fill("neutral")];
}

export const otherTeam = (team: Team): Team => (team === "red" ? "blue" : "red");
