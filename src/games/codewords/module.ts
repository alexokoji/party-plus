import { nextRandom } from "../../engine/rng";
import { listPacks, resolvePack } from "../../content/store";
import "../../content/index"; // side effect: bundled packs are available
import type { WordPack } from "../../content/types";
import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";
import {
  buildKey,
  CODEWORDS_VARIANTS,
  getCodewordsVariant,
  otherTeam,
  type CardOwner,
  type CodewordsRules,
  type Team,
} from "./rules";

/**
 * Code Words — two teams, one hidden key, one very bad card.
 *
 * The whole game is an information asymmetry: the spymasters know which words
 * belong to whom, and their team does not. That asymmetry lives in exactly one
 * place, getPlayerView, which builds an operative's board card by card from an
 * allow-list. Nothing else in this file serialises `key`.
 */

export type Role = "spymaster" | "operative";

export interface CodewordsMove {
  type: "clue" | "guess" | "endTurn";
  /** clue: the single word. */
  word?: string;
  /** clue: how many cards it points at. */
  count?: number;
  /** guess: index into the grid. */
  cardIndex?: number;
}

export interface CodewordsPlayer {
  id: string;
  team: Team;
  role: Role;
}

export interface Clue {
  word: string;
  count: number;
  team: Team;
  by: string;
  at: number;
}

export interface CodewordsState {
  rules: CodewordsRules;
  packId: string;
  packName: string;
  players: CodewordsPlayer[];
  words: string[];
  /** THE SECRET. Parallel to `words`. Spymasters only. */
  key: CardOwner[];
  revealed: boolean[];
  turn: Team;
  phase: "clue" | "guess";
  clue: Clue | null;
  /** Guesses left on the current clue; null when no clue is on the table. */
  guessesLeft: number | null;
  history: Clue[];
  phaseEndsAt: number;
  finished: boolean;
  winners: string[];
  winningTeam: Team | null;
  /** Why it ended, for the result banner. */
  endReason: "cleared" | "assassin" | null;
  rngState: number;
}

export interface CodewordsCardView {
  word: string;
  revealed: boolean;
  /**
   * Who the card belongs to — present only when the recipient is entitled to
   * know: a revealed card, or a spymaster looking at their own key.
   */
  owner: CardOwner | null;
}

export interface CodewordsPlayerView {
  rulesId: string;
  rulesName: string;
  packId: string;
  packName: string;
  cards: CodewordsCardView[];
  players: Array<{ id: string; team: Team; role: Role }>;
  /** This recipient's seat, or null for spectators. */
  me: { team: Team; role: Role } | null;
  /** True only for a spymaster, and the only case where owners are populated. */
  seesKey: boolean;
  turn: Team;
  phase: "clue" | "guess";
  clue: Clue | null;
  guessesLeft: number | null;
  history: Clue[];
  phaseEndsAt: number;
  /** Cards left for each team, which is public information. */
  remaining: Record<Team, number>;
  canAct: boolean;
  finished: boolean;
  winners: string[];
  winningTeam: Team | null;
  endReason: CodewordsState["endReason"];
}

const isType = (move: unknown, type: string): boolean =>
  !!move && typeof move === "object" && (move as { type?: unknown }).type === type;

const playerOf = (state: CodewordsState, id: string) =>
  state.players.find((p) => p.id === id) ?? null;

/** Normalised form used for every word comparison in this module. */
const norm = (word: string) => word.trim().toLowerCase();

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

function remainingFor(state: CodewordsState, team: Team): number {
  return state.key.filter((owner, i) => owner === team && !state.revealed[i]).length;
}

function beginPhase(state: CodewordsState, phase: "clue" | "guess", now: number): void {
  state.phase = phase;
  const seconds = phase === "clue" ? state.rules.clueSeconds : state.rules.guessSeconds;
  state.phaseEndsAt = now + seconds * 1000;
}

/** Hands the turn to the other team and clears the clue. */
function passTurn(state: CodewordsState, now: number): void {
  state.turn = otherTeam(state.turn);
  state.clue = null;
  state.guessesLeft = null;
  beginPhase(state, "clue", now);
}

function finish(state: CodewordsState, team: Team, reason: "cleared" | "assassin"): void {
  state.finished = true;
  state.winningTeam = team;
  state.winners = state.players.filter((p) => p.team === team).map((p) => p.id);
  state.endReason = reason;
  state.guessesLeft = null;
}

/**
 * Splits the table into two teams, each with a spymaster.
 *
 * Seats are shuffled first so the same group does not get the same teams every
 * match, then dealt alternately: that keeps the two sides within one player of
 * each other for any table size.
 */
function assignPlayers(seats: string[], rngState: number): { players: CodewordsPlayer[]; rngState: number } {
  const shuffled = shuffle(seats, rngState);
  const players: CodewordsPlayer[] = shuffled.items.map((id, i) => ({
    id,
    team: i % 2 === 0 ? "red" : "blue",
    role: "operative",
  }));
  // First seat on each team takes the key.
  for (const team of ["red", "blue"] as Team[]) {
    const first = players.find((p) => p.team === team);
    if (first) first.role = "spymaster";
  }
  return { players, rngState: shuffled.rngState };
}

export const codewordsModule: GameModule<CodewordsState, CodewordsMove, CodewordsPlayerView> = {
  meta: {
    id: "codewords",
    name: "Code Words",
    tagline: "Two teams, one secret key, and a word you must never say out loud.",
    minPlayers: 4,
    maxPlayers: 12,
    hasHiddenState: true,
    estimatedMinutes: 20,
    variants: CODEWORDS_VARIANTS.map((v) => ({ id: v.id, name: v.name, description: v.description })),
  },

  /** Word packs, read live so a pack added to the store shows up at once. */
  listOptionGroups() {
    return [
      {
        key: "pack",
        name: "Word pack",
        description: "Where the 25 words come from.",
        options: listPacks("words").map((p) => ({
          id: p.id,
          name: p.name,
          description: `${p.description} (${p.size} words)`,
        })),
      },
    ];
  },

  createInitialState(seats, options: GameOptions = {}): CodewordsState {
    const rules = getCodewordsVariant(options.variant as string | undefined);
    const pack = resolvePack<WordPack>("words", options.pack as string | undefined);
    let rngState = (options.seed as number | undefined) ?? Math.floor(Math.random() * 2 ** 31);

    const assigned = assignPlayers(seats, rngState);
    rngState = assigned.rngState;

    const drawn = shuffle(pack.words, rngState);
    rngState = drawn.rngState;
    const words = drawn.items.slice(0, rules.gridSize);

    // Red and blue take turns starting, decided by the same stream.
    const coin = nextRandom(rngState);
    rngState = coin.state;
    const firstTeam: Team = coin.value < 0.5 ? "red" : "blue";

    const keyed = shuffle(buildKey(rules, firstTeam), rngState);
    rngState = keyed.rngState;

    const now = (options.now as number | undefined) ?? Date.now();

    return {
      rules,
      packId: pack.id,
      packName: pack.name,
      players: assigned.players,
      words,
      key: keyed.items,
      revealed: words.map(() => false),
      turn: firstTeam,
      phase: "clue",
      clue: null,
      guessesLeft: null,
      history: [],
      phaseEndsAt: now + rules.clueSeconds * 1000,
      finished: false,
      winners: [],
      winningTeam: null,
      endReason: null,
      rngState,
    };
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished) return false;
    const me = playerOf(state, playerId);
    if (!me || me.team !== state.turn) return false;

    if (isType(move, "clue")) {
      if (state.phase !== "clue" || me.role !== "spymaster") return false;
      const word = (move as CodewordsMove).word;
      const count = (move as CodewordsMove).count;
      if (typeof word !== "string") return false;
      const clean = norm(word);
      // One word: a clue with a space in it is a sentence, and a sentence can
      // carry far more information than the rules intend.
      if (clean.length === 0 || clean.length > 24 || /\s/.test(clean)) return false;
      // Naming a word that is on the table gives the game away outright.
      if (state.words.some((w) => norm(w) === clean)) return false;
      if (typeof count !== "number" || !Number.isInteger(count)) return false;
      const min = state.rules.allowZeroClues ? 0 : 1;
      return count >= min && count <= 9;
    }

    if (isType(move, "guess")) {
      if (state.phase !== "guess" || me.role !== "operative") return false;
      const index = (move as CodewordsMove).cardIndex;
      if (typeof index !== "number" || !Number.isInteger(index)) return false;
      if (index < 0 || index >= state.words.length) return false;
      return !state.revealed[index];
    }

    if (isType(move, "endTurn")) {
      // Only meaningful once a clue is on the table: stopping is a decision the
      // guessing team makes, not a way for a spymaster to skip their own clue.
      return state.phase === "guess" && me.role === "operative";
    }

    return false;
  },

  applyMove(state, playerId, move): ApplyResult<CodewordsState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const next: CodewordsState = structuredClone(state);
    const events: GameEvent[] = [];
    const me = playerOf(next, playerId)!;
    const now = Date.now();

    if (isType(move, "clue")) {
      const word = (move as CodewordsMove).word!.trim();
      const count = (move as CodewordsMove).count!;
      const clue: Clue = { word, count, team: me.team, by: playerId, at: now };
      next.clue = clue;
      next.history = [...next.history, clue];
      // The extra guess is the standard rule: a team may always try one more
      // than the clue promised, in case an earlier clue went unfinished.
      next.guessesLeft = count === 0 ? next.words.length : count + 1;
      beginPhase(next, "guess", now);
      events.push({
        type: "clue",
        playerId,
        text: `clues ${word} for ${count}`,
        data: { word, count, team: me.team },
      });
      return { state: next, events };
    }

    if (isType(move, "endTurn")) {
      passTurn(next, now);
      events.push({ type: "endTurn", playerId, text: "stops guessing", data: { team: me.team } });
      return { state: next, events };
    }

    // guess
    const index = (move as CodewordsMove).cardIndex!;
    const owner = next.key[index]!;
    const word = next.words[index]!;
    next.revealed[index] = true;
    events.push({
      type: "reveal",
      playerId,
      text: `taps ${word} — ${owner === me.team ? "theirs" : owner}`,
      data: { cardIndex: index, word, owner },
    });

    if (owner === "assassin") {
      // Instant loss for the guessing team, whatever the score was.
      finish(next, otherTeam(me.team), "assassin");
      events.push({
        type: "assassin",
        text: `the assassin was ${word} — ${me.team} loses on the spot`,
        data: { team: me.team },
      });
      return { state: next, events };
    }

    if (owner === me.team) {
      if (remainingFor(next, me.team) === 0) {
        finish(next, me.team, "cleared");
        events.push({ type: "win", text: `${me.team} found every one of their words`, data: { team: me.team } });
        return { state: next, events };
      }
      next.guessesLeft = (next.guessesLeft ?? 1) - 1;
      if (next.guessesLeft <= 0) {
        passTurn(next, now);
        events.push({ type: "endTurn", text: "out of guesses", data: { team: me.team } });
      }
      return { state: next, events };
    }

    // Neutral, or a card belonging to the other team: the turn ends either way.
    if (owner !== "neutral" && remainingFor(next, owner) === 0) {
      // Handing the other team their last card wins it for them.
      finish(next, owner, "cleared");
      events.push({
        type: "win",
        text: `${me.team} handed ${owner} their last word`,
        data: { team: owner },
      });
      return { state: next, events };
    }

    passTurn(next, now);
    return { state: next, events };
  },

  /**
   * The redaction that the entire game rests on.
   *
   * An operative's board is built card by card, and `owner` is only ever set
   * from a revealed card. The key is not spread into the view and then deleted
   * — it never enters the object at all. Spectators are treated as operatives:
   * someone watching the stream must not be able to read the key out loud.
   */
  getPlayerView(state, playerId): CodewordsPlayerView {
    const me = playerId ? playerOf(state, playerId) : null;
    const seesKey = (me?.role === "spymaster" || state.finished) ?? false;

    const cards: CodewordsCardView[] = state.words.map((word, i) => ({
      word,
      revealed: state.revealed[i]!,
      owner: state.revealed[i] || seesKey ? state.key[i]! : null,
    }));

    const canAct =
      !!me &&
      !state.finished &&
      me.team === state.turn &&
      ((state.phase === "clue" && me.role === "spymaster") ||
        (state.phase === "guess" && me.role === "operative"));

    return {
      rulesId: state.rules.id,
      rulesName: state.rules.name,
      packId: state.packId,
      packName: state.packName,
      cards,
      // Teams and roles are public: everyone can see who the spymasters are.
      players: state.players.map((p) => ({ id: p.id, team: p.team, role: p.role })),
      me: me ? { team: me.team, role: me.role } : null,
      seesKey,
      turn: state.turn,
      phase: state.phase,
      clue: state.clue,
      guessesLeft: state.guessesLeft,
      history: state.history,
      phaseEndsAt: state.phaseEndsAt,
      remaining: { red: remainingFor(state, "red"), blue: remainingFor(state, "blue") },
      canAct,
      finished: state.finished,
      winners: state.winners,
      winningTeam: state.winningTeam,
      endReason: state.endReason,
    };
  },

  checkWinCondition(state): WinCondition | null {
    if (!state.finished) return null;
    return { finished: true, winners: state.winners };
  },

  /**
   * During the clue phase exactly one person must act, so the room engine's
   * turn clock applies to them. During the guess phase any operative on the
   * team may tap, so there is no single actor and the phase clock takes over.
   */
  getCurrentPlayerId(state): string | null {
    if (state.finished || state.phase !== "clue") return null;
    return state.players.find((p) => p.team === state.turn && p.role === "spymaster")?.id ?? null;
  },

  getPhaseDeadline(state): number | null {
    return state.finished ? null : state.phaseEndsAt;
  },

  advancePhase(state, now): ApplyResult<CodewordsState> | null {
    if (state.finished) return null;
    if (now < state.phaseEndsAt - 50) return null;

    const next: CodewordsState = structuredClone(state);
    const events: GameEvent[] = [];
    const stalled = next.turn;
    passTurn(next, now);
    events.push({
      type: "timeout",
      text:
        state.phase === "clue"
          ? `${stalled} ran out of time for a clue`
          : `${stalled} ran out of guessing time`,
      data: { team: stalled },
    });
    return { state: next, events };
  },

  /** A spymaster who never clues hands the turn over rather than freezing it. */
  forfeitTurn(state, playerId): CodewordsState | null {
    const me = playerOf(state, playerId);
    if (!me || state.finished || me.team !== state.turn || state.phase !== "clue") return null;
    const next: CodewordsState = structuredClone(state);
    passTurn(next, Date.now());
    return next;
  },
};

export { listPacks as listWordPacks, remainingFor };
