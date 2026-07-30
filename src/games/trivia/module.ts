import { nextRandom } from "../../engine/rng";
import { listPacks, resolvePack } from "../../content/store";
import "../../content/index"; // side effect: bundled packs are available
import type { TriviaPack, TriviaQuestion } from "../../content/types";
import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";
import { getTriviaVariant, scoreAnswer, TRIVIA_VARIANTS, type TriviaRules } from "./rules";

/**
 * Trivia.
 *
 * The answer key is the hidden state, and it is hidden from everyone — there
 * is no privileged seat that gets to see it, unlike the spymasters in Code
 * Words. getPlayerView sends the question and its options and nothing else;
 * `answerIndex` only appears once the question has closed and can no longer be
 * answered. Answers are checked here, on the server, against state the client
 * has never been given.
 */

export type TriviaMove = { type: "answer"; optionIndex: number } | { type: "skip" };

export interface TriviaAnswer {
  playerId: string;
  optionIndex: number;
  /** Ms after the question opened. */
  elapsedMs: number;
  correct: boolean;
  points: number;
}

export interface TriviaRound {
  /** The question as asked, answer key included. NEVER serialised while open. */
  question: TriviaQuestion;
  openedAt: number;
  answers: TriviaAnswer[];
}

export interface TriviaState {
  rules: TriviaRules;
  packId: string;
  packName: string;
  players: string[];
  rounds: TriviaRound[];
  /** Index into `rounds` of the question in play. */
  current: number;
  phase: "question" | "reveal" | "over";
  phaseEndsAt: number;
  scores: Record<string, number>;
  /** Consecutive correct answers, for a bit of colour on the leaderboard. */
  streaks: Record<string, number>;
  finished: boolean;
  winners: string[];
  rngState: number;
}

export interface TriviaLeaderRow {
  playerId: string;
  score: number;
  streak: number;
  /** Whether they answered the question just closed, and how it went. */
  lastAnswerCorrect: boolean | null;
  lastPoints: number;
}

export interface TriviaPlayerView {
  rulesId: string;
  rulesName: string;
  packId: string;
  packName: string;
  questionNumber: number;
  questionTotal: number;
  phase: TriviaState["phase"];
  phaseEndsAt: number;
  /** The question text and options — never the key. */
  question: { id: string; text: string; options: string[]; category?: string } | null;
  /** This recipient's own answer to the open question, if they have given one. */
  myAnswer: number | null;
  /** How many people have answered — public, and useful pressure. */
  answeredCount: number;
  playerCount: number;
  /**
   * Set only once the question has closed: at that point the key is no longer
   * secret and showing it is the entire point of the reveal.
   */
  reveal: { correctIndex: number; note?: string; counts: number[] } | null;
  leaderboard: TriviaLeaderRow[];
  canAnswer: boolean;
  finished: boolean;
  winners: string[];
}

const isType = (move: unknown, type: string): boolean =>
  !!move && typeof move === "object" && (move as { type?: unknown }).type === type;

function shuffle<T>(items: T[], rngState: number): { items: T[]; rngState: number } {
  const out = [...items];
  let state = rngState;
  for (let i = out.length - 1; i > 0; i--) {
    const next = nextRandom(state);
    state = next.state;
    const j = Math.floor(next.value * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return { items: out, rngState: state };
}

/**
 * Shuffles a question's options and moves the key with them.
 *
 * Without this, a pack whose answers cluster at index 0 would be guessable
 * from the position alone.
 */
function shuffleOptions(q: TriviaQuestion, rngState: number): { question: TriviaQuestion; rngState: number } {
  const paired = q.options.map((text, i) => ({ text, correct: i === q.answerIndex }));
  const shuffled = shuffle(paired, rngState);
  return {
    question: {
      ...q,
      options: shuffled.items.map((o) => o.text),
      answerIndex: shuffled.items.findIndex((o) => o.correct),
    },
    rngState: shuffled.rngState,
  };
}

const roundOf = (state: TriviaState): TriviaRound | null => state.rounds[state.current] ?? null;

/** Everyone who is still expected to answer the open question. */
function outstanding(state: TriviaState): string[] {
  const round = roundOf(state);
  if (!round) return [];
  return state.players.filter((id) => !round.answers.some((a) => a.playerId === id));
}

function leaderboard(state: TriviaState): TriviaLeaderRow[] {
  // The row's "last answer" refers to the question just closed, which is the
  // current one during the reveal and at the end of the match.
  const round = roundOf(state);
  const showLast = state.phase !== "question";
  return state.players
    .map((playerId) => {
      const answer = showLast ? round?.answers.find((a) => a.playerId === playerId) ?? null : null;
      return {
        playerId,
        score: state.scores[playerId] ?? 0,
        streak: state.streaks[playerId] ?? 0,
        lastAnswerCorrect: answer ? answer.correct : null,
        lastPoints: answer?.points ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
}

function topScorers(state: TriviaState): string[] {
  const best = Math.max(...state.players.map((id) => state.scores[id] ?? 0));
  return state.players.filter((id) => (state.scores[id] ?? 0) === best);
}

/** Closes the open question and shows the answer. */
function closeQuestion(state: TriviaState, events: GameEvent[], now: number): void {
  const round = roundOf(state);
  state.phase = "reveal";
  state.phaseEndsAt = now + state.rules.revealSeconds * 1000;
  if (!round) return;

  // A missing answer breaks a streak just as a wrong one does.
  for (const id of state.players) {
    if (!round.answers.some((a) => a.playerId === id && a.correct)) state.streaks[id] = 0;
  }

  const correct = round.answers.filter((a) => a.correct).length;
  events.push({
    type: "reveal",
    text:
      correct === 0
        ? "nobody got that one"
        : `${correct} of ${state.players.length} got it — the answer was ${round.question.options[round.question.answerIndex]}`,
    data: { correctIndex: round.question.answerIndex },
  });
}

/** Moves on to the next question, or ends the match. */
function advanceQuestion(state: TriviaState, events: GameEvent[], now: number): void {
  if (state.current + 1 >= state.rounds.length) {
    state.phase = "over";
    state.finished = true;
    state.winners = topScorers(state);
    events.push({
      type: "matchOver",
      text: state.winners.length > 1 ? "it ends in a tie" : "that's the last question",
      data: { winners: state.winners },
    });
    return;
  }
  state.current += 1;
  state.phase = "question";
  const round = state.rounds[state.current]!;
  round.openedAt = now;
  state.phaseEndsAt = now + state.rules.secondsPerQuestion * 1000;
  events.push({
    type: "question",
    text: `question ${state.current + 1} of ${state.rounds.length}`,
    data: { number: state.current + 1 },
  });
}

export const triviaModule: GameModule<TriviaState, TriviaMove, TriviaPlayerView> = {
  meta: {
    id: "trivia",
    name: "Trivia",
    tagline: "Timed questions, faster answers score more. The answer key never leaves the server.",
    minPlayers: 2,
    maxPlayers: 12,
    hasHiddenState: true,
    estimatedMinutes: 12,
    variants: TRIVIA_VARIANTS.map((v) => ({ id: v.id, name: v.name, description: v.description })),
  },

  /** Question packs, read live from the content store. */
  listOptionGroups() {
    return [
      {
        key: "pack",
        name: "Question pack",
        description: "Which bank the questions come from.",
        options: listPacks("trivia").map((p) => ({
          id: p.id,
          name: p.name,
          description: `${p.description} (${p.size} questions)`,
        })),
      },
    ];
  },

  createInitialState(players, options: GameOptions = {}): TriviaState {
    const rules = getTriviaVariant(options.variant as string | undefined);
    const pack = resolvePack<TriviaPack>("trivia", options.pack as string | undefined);
    let rngState = (options.seed as number | undefined) ?? Math.floor(Math.random() * 2 ** 31);
    const now = (options.now as number | undefined) ?? Date.now();

    const picked = shuffle(pack.questions, rngState);
    rngState = picked.rngState;

    const rounds: TriviaRound[] = [];
    // A short pack simply makes a short match rather than repeating questions.
    for (const q of picked.items.slice(0, rules.questionCount)) {
      const shuffled = shuffleOptions(q, rngState);
      rngState = shuffled.rngState;
      rounds.push({ question: shuffled.question, openedAt: now, answers: [] });
    }

    return {
      rules,
      packId: pack.id,
      packName: pack.name,
      players: [...players],
      rounds,
      current: 0,
      phase: "question",
      phaseEndsAt: now + rules.secondsPerQuestion * 1000,
      scores: Object.fromEntries(players.map((id) => [id, 0])),
      streaks: Object.fromEntries(players.map((id) => [id, 0])),
      finished: false,
      winners: [],
      rngState,
    };
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished || state.phase !== "question") return false;
    if (!state.players.includes(playerId)) return false;
    const round = roundOf(state);
    if (!round) return false;
    // One answer each: no changing your mind once it is in.
    if (round.answers.some((a) => a.playerId === playerId)) return false;

    if (isType(move, "skip")) return true;
    if (!isType(move, "answer")) return false;

    const index = (move as { optionIndex?: unknown }).optionIndex;
    if (typeof index !== "number" || !Number.isInteger(index)) return false;
    return index >= 0 && index < round.question.options.length;
  },

  applyMove(state, playerId, move): ApplyResult<TriviaState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const next: TriviaState = structuredClone(state);
    const events: GameEvent[] = [];
    const round = roundOf(next)!;
    const now = Date.now();

    if (isType(move, "skip")) {
      round.answers.push({ playerId, optionIndex: -1, elapsedMs: now - round.openedAt, correct: false, points: 0 });
      next.streaks[playerId] = 0;
    } else {
      const optionIndex = (move as { optionIndex: number }).optionIndex;
      // The comparison happens here and only here. The client was never told
      // what it is comparing against, so a doctored client cannot answer better
      // than a guess.
      const correct = optionIndex === round.question.answerIndex;
      const elapsedMs = Math.max(0, now - round.openedAt);
      const points = correct
        ? scoreAnswer(next.rules, elapsedMs)
        : -next.rules.wrongPenalty;

      round.answers.push({ playerId, optionIndex, elapsedMs, correct, points });
      next.scores[playerId] = (next.scores[playerId] ?? 0) + points;
      next.streaks[playerId] = correct ? (next.streaks[playerId] ?? 0) + 1 : 0;

      // Deliberately says nothing about whether they were right: that would
      // hand the answer to everyone still thinking.
      events.push({ type: "answered", playerId, text: "locked in an answer" });
    }

    // Everyone has answered — no reason to sit watching a dead clock.
    if (outstanding(next).length === 0) closeQuestion(next, events, now);

    return { state: next, events };
  },

  /**
   * Question and options only.
   *
   * `round.question` carries `answerIndex`, so it is never spread into the
   * view — the fields are copied across one at a time. The reveal block is the
   * single place the key appears, and only once the question has closed.
   */
  getPlayerView(state, playerId): TriviaPlayerView {
    const round = roundOf(state);
    const mine = playerId ? round?.answers.find((a) => a.playerId === playerId) ?? null : null;
    const closed = state.phase !== "question";

    const counts: number[] = round ? round.question.options.map(() => 0) : [];
    if (round && closed) {
      for (const a of round.answers) {
        if (a.optionIndex >= 0 && a.optionIndex < counts.length) counts[a.optionIndex]!++;
      }
    }

    return {
      rulesId: state.rules.id,
      rulesName: state.rules.name,
      packId: state.packId,
      packName: state.packName,
      questionNumber: state.current + 1,
      questionTotal: state.rounds.length,
      phase: state.phase,
      phaseEndsAt: state.phaseEndsAt,
      question: round
        ? {
            id: round.question.id,
            text: round.question.question,
            options: [...round.question.options],
            category: round.question.category,
          }
        : null,
      myAnswer: mine ? mine.optionIndex : null,
      answeredCount: round?.answers.length ?? 0,
      playerCount: state.players.length,
      reveal:
        round && closed
          ? { correctIndex: round.question.answerIndex, note: round.question.note, counts }
          : null,
      leaderboard: leaderboard(state),
      canAnswer: !!playerId && state.phase === "question" && !mine && state.players.includes(playerId),
      finished: state.finished,
      winners: state.winners,
    };
  },

  checkWinCondition(state): WinCondition | null {
    if (!state.finished) return null;
    return { finished: true, winners: state.winners };
  },

  /** Everybody answers at once, so nobody in particular is "on turn". */
  getCurrentPlayerId(): string | null {
    return null;
  },

  getPhaseDeadline(state): number | null {
    return state.finished ? null : state.phaseEndsAt;
  },

  advancePhase(state, now): ApplyResult<TriviaState> | null {
    if (state.finished) return null;
    if (now < state.phaseEndsAt - 50) return null;

    const next: TriviaState = structuredClone(state);
    const events: GameEvent[] = [];

    if (next.phase === "question") {
      closeQuestion(next, events, now);
    } else {
      advanceQuestion(next, events, now);
    }
    return { state: next, events };
  },
};

export { leaderboard, listPacks as listTriviaPacks, outstanding };
