import { nextRandom } from "../../engine/rng";
import { listPacks, resolvePack } from "../../content/store";
import "../../content/index"; // side effect: bundled packs are available
import type { DrawPack } from "../../content/types";
import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";
import {
  editDistance,
  getSketchVariant,
  maskWord,
  normalizeGuess,
  scoreGuess,
  SKETCH_VARIANTS,
  type SketchRules,
} from "./rules";

/**
 * Sketch & Guess.
 *
 * The word is the hidden state and only the drawer ever sees it. Guesses are
 * typed as free text and compared HERE, against a word the guesser's client
 * has never held — the client cannot check its own guess, which is the point.
 *
 * The drawing itself does not live in this state at all: strokes go through
 * the room's ephemeral stream channel (see authorizeStream), so a 60-per-second
 * pointer trail never becomes 60 state writes.
 */

export type SketchMove =
  | { type: "chooseWord"; index: number }
  | { type: "guess"; text: string }
  | { type: "skipTurn" };

export interface SketchGuess {
  playerId: string;
  /**
   * What they typed — but only for wrong guesses. A correct guess is the word
   * itself, so publishing it would hand it to everyone still guessing.
   */
  text: string | null;
  correct: boolean;
  /** "warm" tells the room someone was one letter away, without saying what. */
  close: boolean;
  at: number;
  points: number;
}

export interface SketchTurn {
  drawerId: string;
  round: number;
  /** THE SECRET: the word being drawn. */
  word: string;
  /** Also secret: the shortlist the drawer picked from. */
  choices: string[];
  startedAt: number;
  /** Indexes of letters revealed as hints so far. */
  hints: number[];
  guesses: SketchGuess[];
}

export interface SketchState {
  rules: SketchRules;
  packId: string;
  packName: string;
  players: string[];
  /** Draw order for the whole match. */
  order: string[];
  round: number;
  /** Index into `order` of the current drawer. */
  turnIndex: number;
  phase: "choosing" | "drawing" | "between" | "over";
  phaseEndsAt: number;
  turn: SketchTurn | null;
  /** Turns already played, for the end-of-match recap. */
  past: Array<{ drawerId: string; word: string; solvedBy: string[] }>;
  scores: Record<string, number>;
  /** Words already used, so a match never repeats one. */
  used: string[];
  finished: boolean;
  winners: string[];
  rngState: number;
}

export interface SketchPlayerView {
  rulesId: string;
  rulesName: string;
  packId: string;
  packName: string;
  round: number;
  roundTotal: number;
  phase: SketchState["phase"];
  phaseEndsAt: number;
  drawerId: string | null;
  /** True when this recipient is holding the pen. */
  iAmDrawing: boolean;
  /** The word — drawer only, or everyone once the turn is over. */
  word: string | null;
  /** Masked form for guessers: letter count, spaces, and any revealed hints. */
  wordMask: string | null;
  /** The shortlist, drawer only, during the choosing phase. */
  choices: string[] | null;
  guesses: SketchGuess[];
  /** Whether this recipient has already solved it. */
  iSolved: boolean;
  solvedBy: string[];
  scores: Array<{ playerId: string; score: number; solvedThisTurn: boolean }>;
  canGuess: boolean;
  canChoose: boolean;
  finished: boolean;
  winners: string[];
  past: SketchState["past"];
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

const solversOf = (turn: SketchTurn): string[] =>
  turn.guesses.filter((g) => g.correct).map((g) => g.playerId);

/** Offers the next drawer a shortlist, avoiding words already used this match. */
function beginChoosing(state: SketchState, now: number, events: GameEvent[]): void {
  const pack = resolvePack<DrawPack>("draw", state.packId);
  const fresh = pack.words.filter((w) => !state.used.includes(w.word));
  // A long match can exhaust a small pack; reuse rather than deal nothing.
  const pool = fresh.length >= state.rules.wordChoices ? fresh : pack.words;

  const picked = shuffle(pool, state.rngState);
  state.rngState = picked.rngState;
  const choices = picked.items.slice(0, state.rules.wordChoices).map((w) => w.word);

  state.phase = "choosing";
  state.phaseEndsAt = now + state.rules.chooseSeconds * 1000;
  state.turn = {
    drawerId: state.order[state.turnIndex]!,
    round: state.round,
    word: choices[0]!, // stands in until they pick; never sent to anyone else
    choices,
    startedAt: now,
    hints: [],
    guesses: [],
  };
  events.push({
    type: "turn",
    playerId: state.turn.drawerId,
    text: "is choosing a word",
    data: { round: state.round },
  });
}

/** Ends the current turn, pays the drawer, and shows the word. */
function endTurn(state: SketchState, now: number, events: GameEvent[]): void {
  const turn = state.turn;
  state.phase = "between";
  state.phaseEndsAt = now + state.rules.betweenSeconds * 1000;
  if (!turn) return;

  const solvers = solversOf(turn);
  const drawerPoints = solvers.length * state.rules.drawerPointsPerGuess;
  state.scores[turn.drawerId] = (state.scores[turn.drawerId] ?? 0) + drawerPoints;
  state.past.push({ drawerId: turn.drawerId, word: turn.word, solvedBy: solvers });

  events.push({
    type: "turnOver",
    text:
      solvers.length === 0
        ? `nobody got it — the word was ${turn.word}`
        : `the word was ${turn.word}, and ${solvers.length} got it`,
    data: { word: turn.word, solvers: solvers.length },
  });
}

/** Moves to the next drawer, or ends the match. */
function nextTurn(state: SketchState, now: number, events: GameEvent[]): void {
  state.turnIndex += 1;
  if (state.turnIndex >= state.order.length) {
    state.turnIndex = 0;
    state.round += 1;
  }
  if (state.round > state.rules.rounds) {
    state.phase = "over";
    state.finished = true;
    const best = Math.max(...state.players.map((id) => state.scores[id] ?? 0));
    state.winners = state.players.filter((id) => (state.scores[id] ?? 0) === best);
    state.turn = null;
    events.push({ type: "matchOver", text: "that's the last drawing", data: { winners: state.winners } });
    return;
  }
  beginChoosing(state, now, events);
}

/** Reveals one more letter, chosen from those still hidden. */
function addHint(state: SketchState): void {
  const turn = state.turn;
  if (!turn) return;
  const candidates = turn.word
    .split("")
    .map((ch, i) => (/[a-zA-Z0-9]/.test(ch) && !turn.hints.includes(i) ? i : -1))
    .filter((i) => i >= 0);
  // Never unmask the last letter: that would just be showing them the word.
  if (candidates.length <= 1) return;
  const next = nextRandom(state.rngState);
  state.rngState = next.state;
  turn.hints.push(candidates[Math.floor(next.value * candidates.length)]!);
}

export const sketchModule: GameModule<SketchState, SketchMove, SketchPlayerView> = {
  meta: {
    id: "sketch",
    name: "Sketch & Guess",
    tagline: "Draw it badly, guess it fast. The word never reaches the guessers.",
    minPlayers: 3,
    maxPlayers: 12,
    hasHiddenState: true,
    estimatedMinutes: 15,
    variants: SKETCH_VARIANTS.map((v) => ({ id: v.id, name: v.name, description: v.description })),
  },

  /** Word packs to draw from, read live from the content store. */
  listOptionGroups() {
    return [
      {
        key: "pack",
        name: "Word pack",
        description: "What people will be asked to draw.",
        options: listPacks("draw").map((p) => ({
          id: p.id,
          name: p.name,
          description: `${p.description} (${p.size} words)`,
        })),
      },
    ];
  },

  createInitialState(players, options: GameOptions = {}): SketchState {
    const rules = getSketchVariant(options.variant as string | undefined);
    const pack = resolvePack<DrawPack>("draw", options.pack as string | undefined);
    const now = (options.now as number | undefined) ?? Date.now();
    let rngState = (options.seed as number | undefined) ?? Math.floor(Math.random() * 2 ** 31);

    const ordered = shuffle(players, rngState);
    rngState = ordered.rngState;

    const state: SketchState = {
      rules,
      packId: pack.id,
      packName: pack.name,
      players: [...players],
      order: ordered.items,
      round: 1,
      turnIndex: 0,
      phase: "choosing",
      phaseEndsAt: now + rules.chooseSeconds * 1000,
      turn: null,
      past: [],
      scores: Object.fromEntries(players.map((id) => [id, 0])),
      used: [],
      finished: false,
      winners: [],
      rngState,
    };
    beginChoosing(state, now, []);
    return state;
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished || !state.turn) return false;
    if (!state.players.includes(playerId)) return false;
    const isDrawer = playerId === state.turn.drawerId;

    if (isType(move, "chooseWord")) {
      if (state.phase !== "choosing" || !isDrawer) return false;
      const index = (move as { index?: unknown }).index;
      return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < state.turn.choices.length;
    }

    if (isType(move, "skipTurn")) {
      return isDrawer && (state.phase === "choosing" || state.phase === "drawing");
    }

    if (isType(move, "guess")) {
      // The drawer guessing their own word would be a fine way to farm points.
      if (state.phase !== "drawing" || isDrawer) return false;
      const text = (move as { text?: unknown }).text;
      if (typeof text !== "string") return false;
      const clean = text.trim();
      if (clean.length === 0 || clean.length > 64) return false;
      // Once you have it, you are done: no re-guessing for a better score.
      return !state.turn.guesses.some((g) => g.playerId === playerId && g.correct);
    }

    return false;
  },

  applyMove(state, playerId, move): ApplyResult<SketchState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const next: SketchState = structuredClone(state);
    const events: GameEvent[] = [];
    const turn = next.turn!;
    const now = Date.now();

    if (isType(move, "chooseWord")) {
      const index = (move as { index: number }).index;
      turn.word = turn.choices[index]!;
      next.used.push(turn.word);
      turn.startedAt = now;
      next.phase = "drawing";
      next.phaseEndsAt = now + next.rules.drawSeconds * 1000;
      // Says only that drawing has begun: the word stays with the drawer.
      events.push({ type: "drawing", playerId, text: "is drawing", data: { round: next.round } });
      return { state: next, events };
    }

    if (isType(move, "skipTurn")) {
      events.push({ type: "skip", playerId, text: "passed their turn" });
      endTurn(next, now, events);
      return { state: next, events };
    }

    // guess
    const raw = (move as { text: string }).text.trim();
    const guessed = normalizeGuess(raw);
    const target = normalizeGuess(turn.word);
    const correct = guessed === target;
    const close = !correct && guessed.length > 0 && editDistance(guessed, target, 1) <= 1;

    let points = 0;
    if (correct) {
      const place = solversOf(turn).length;
      const msLeft = Math.max(0, next.phaseEndsAt - now);
      points = scoreGuess(next.rules, place, msLeft, next.rules.drawSeconds * 1000);
      next.scores[playerId] = (next.scores[playerId] ?? 0) + points;
    }

    turn.guesses.push({
      playerId,
      // A correct guess IS the word; publishing the text would end the round
      // for everyone reading the feed.
      text: correct ? null : raw,
      correct,
      close,
      at: now,
      points,
    });

    events.push(
      correct
        ? { type: "solved", playerId, text: "guessed it!", data: { points } }
        : { type: "guess", playerId, text: close ? `guessed "${raw}" — close` : `guessed "${raw}"` }
    );

    // Everyone but the drawer has it: no reason to keep drawing.
    const guessers = next.players.filter((id) => id !== turn.drawerId);
    if (guessers.every((id) => solversOf(turn).includes(id))) {
      endTurn(next, now, events);
    }

    return { state: next, events };
  },

  /**
   * The word goes to exactly one person.
   *
   * Guessers get a mask — letter count and any revealed hints — which is
   * generated from the word rather than being the word. `turn.choices` is
   * equally secret: it would narrow the answer to one of three or four.
   */
  getPlayerView(state, playerId): SketchPlayerView {
    const turn = state.turn;
    const iAmDrawing = !!playerId && !!turn && turn.drawerId === playerId;
    // The word becomes public exactly when it stops mattering: at the end of
    // the turn, and at the end of the match.
    const wordIsPublic = state.phase === "between" || state.phase === "over";
    const solved = turn ? solversOf(turn) : [];

    return {
      rulesId: state.rules.id,
      rulesName: state.rules.name,
      packId: state.packId,
      packName: state.packName,
      round: state.round,
      roundTotal: state.rules.rounds,
      phase: state.phase,
      phaseEndsAt: state.phaseEndsAt,
      drawerId: turn?.drawerId ?? null,
      iAmDrawing,
      word: turn && (iAmDrawing || wordIsPublic) ? turn.word : null,
      wordMask: turn && state.phase === "drawing" ? maskWord(turn.word, turn.hints) : null,
      choices: turn && iAmDrawing && state.phase === "choosing" ? [...turn.choices] : null,
      guesses: turn ? turn.guesses : [],
      iSolved: !!playerId && solved.includes(playerId),
      solvedBy: solved,
      scores: state.players
        .map((id) => ({
          playerId: id,
          score: state.scores[id] ?? 0,
          solvedThisTurn: solved.includes(id),
        }))
        .sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId)),
      canGuess:
        !!playerId &&
        state.phase === "drawing" &&
        !iAmDrawing &&
        state.players.includes(playerId) &&
        !solved.includes(playerId),
      canChoose: iAmDrawing && state.phase === "choosing",
      finished: state.finished,
      winners: state.winners,
      past: state.past,
    };
  },

  checkWinCondition(state): WinCondition | null {
    if (!state.finished) return null;
    return { finished: true, winners: state.winners };
  },

  /**
   * Only the choosing phase has a single actor. While the drawing runs,
   * everyone is doing something at once, so the phase clock governs.
   */
  getCurrentPlayerId(state): string | null {
    if (state.finished || state.phase !== "choosing") return null;
    return state.turn?.drawerId ?? null;
  },

  getPhaseDeadline(state): number | null {
    return state.finished ? null : state.phaseEndsAt;
  },

  advancePhase(state, now): ApplyResult<SketchState> | null {
    if (state.finished) return null;

    // Hints are due partway through a drawing, before the phase itself ends.
    if (state.phase === "drawing" && state.turn) {
      const total = state.rules.drawSeconds * 1000;
      const fractionLeft = (state.phaseEndsAt - now) / total;
      const due = state.rules.hintAt.filter((h) => fractionLeft <= h).length;
      if (due > state.turn.hints.length && now < state.phaseEndsAt - 50) {
        const next: SketchState = structuredClone(state);
        addHint(next);
        return {
          state: next,
          events: [{ type: "hint", text: "a letter appears", data: { hints: next.turn!.hints.length } }],
        };
      }
    }

    if (now < state.phaseEndsAt - 50) return null;

    const next: SketchState = structuredClone(state);
    const events: GameEvent[] = [];

    if (next.phase === "choosing") {
      // Nobody picked: take the first word and start anyway, rather than
      // stalling the whole table on one player.
      const turn = next.turn!;
      turn.word = turn.choices[0]!;
      next.used.push(turn.word);
      turn.startedAt = now;
      next.phase = "drawing";
      next.phaseEndsAt = now + next.rules.drawSeconds * 1000;
      events.push({ type: "drawing", playerId: turn.drawerId, text: "is drawing" });
    } else if (next.phase === "drawing") {
      endTurn(next, now, events);
    } else {
      nextTurn(next, now, events);
    }

    return { state: next, events };
  },

  /**
   * The live drawing channel.
   *
   * Only the current drawer, only while they are actually drawing, and only on
   * the drawing channel. Everything else is refused, which is what stops a
   * guesser scribbling over the canvas or opening a side channel of their own.
   */
  authorizeStream(state, playerId, channel): boolean {
    if (state.finished || state.phase !== "drawing" || !state.turn) return false;
    if (channel !== "draw") return false;
    return playerId === state.turn.drawerId;
  },
};

export { listPacks as listDrawPacks, solversOf };
