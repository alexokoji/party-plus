import { Chess } from "chess.js";
import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";

/**
 * Chess, backed by chess.js.
 *
 * Legal move generation is deliberately NOT hand-rolled: castling rights, en
 * passant, promotion, pin detection, check evasion, threefold repetition and
 * the fifty-move rule are a notorious source of subtle bugs. chess.js is
 * mature and well tested, so this module's job is to hold its state, ask it
 * what is legal, and translate its verdicts into the platform's vocabulary.
 *
 * State is stored as FEN plus the SAN history — both plain strings, so the
 * whole game serialises cleanly into Durable Object storage. The Chess object
 * is reconstructed per call rather than held live.
 */

export type ChessColor = "w" | "b";

export interface ChessClockRules {
  enabled: boolean;
  /** Starting time per player, in seconds. */
  initialSeconds: number;
  /** Added to a player's clock after each of their moves (Fischer). */
  incrementSeconds: number;
}

export interface ChessRules {
  id: string;
  name: string;
  description: string;
  clock: ChessClockRules;
}

export const CASUAL_CHESS: ChessRules = {
  id: "casual",
  name: "Casual",
  description: "No clock — take as long as you like (the room's turn timer still applies).",
  clock: { enabled: false, initialSeconds: 0, incrementSeconds: 0 },
};

export const RAPID_CHESS: ChessRules = {
  id: "rapid",
  name: "Rapid 10+5",
  description: "Ten minutes each, plus five seconds a move.",
  clock: { enabled: true, initialSeconds: 600, incrementSeconds: 5 },
};

export const BLITZ_CHESS: ChessRules = {
  id: "blitz",
  name: "Blitz 5+3",
  description: "Five minutes each, plus three seconds a move.",
  clock: { enabled: true, initialSeconds: 300, incrementSeconds: 3 },
};

export const BULLET_CHESS: ChessRules = {
  id: "bullet",
  name: "Bullet 1+0",
  description: "One minute each. No increment. Good luck.",
  clock: { enabled: true, initialSeconds: 60, incrementSeconds: 0 },
};

export const CHESS_VARIANTS: ChessRules[] = [CASUAL_CHESS, RAPID_CHESS, BLITZ_CHESS, BULLET_CHESS];

export function getChessVariant(id: string | undefined): ChessRules {
  return CHESS_VARIANTS.find((v) => v.id === id) ?? CASUAL_CHESS;
}

export interface ChessMove {
  type: "move";
  from: string;
  to: string;
  /** Required when a pawn reaches the last rank. */
  promotion?: "q" | "r" | "b" | "n";
}

export type ChessEndReason =
  | "checkmate"
  | "stalemate"
  | "insufficient-material"
  | "threefold-repetition"
  | "fifty-move"
  | "timeout"
  | null;

export interface ChessState {
  rules: ChessRules;
  /** Full position, including castling rights, en passant square and clocks. */
  fen: string;
  /** SAN moves so far, for the move list. */
  history: string[];
  players: { id: string; color: ChessColor }[];
  finished: boolean;
  winners: string[];
  drawn: boolean;
  endReason: ChessEndReason;
  /** Remaining milliseconds per colour; null when the clock is off. */
  clock: { w: number; b: number } | null;
  /** When the side to move started thinking, for clock accounting. */
  turnStartedAt: number | null;
  /** Squares of the most recent move, for board highlighting. */
  lastMove: { from: string; to: string } | null;
}

export interface ChessLegalMove {
  from: string;
  to: string;
  san: string;
  promotion?: string;
  captured?: string;
}

export interface ChessPlayerView {
  rulesId: string;
  rulesName: string;
  fen: string;
  /** 8 rows of 8, top-left = a8, as `wp`/`bk` style codes or null. */
  board: (string | null)[][];
  history: string[];
  players: { id: string; color: ChessColor }[];
  turn: ChessColor;
  currentPlayerId: string | null;
  /** Legal moves for the player to act; empty when it is not their turn. */
  legalMoves: ChessLegalMove[];
  inCheck: boolean;
  finished: boolean;
  winners: string[];
  drawn: boolean;
  endReason: ChessEndReason;
  clock: { w: number; b: number } | null;
  myColor: ChessColor | null;
  lastMove: { from: string; to: string } | null;
}

/** Rebuilds a chess.js game from stored state. */
function load(state: ChessState): Chess {
  const game = new Chess();
  game.load(state.fen);
  return game;
}

function isChessMove(move: unknown): move is ChessMove {
  if (typeof move !== "object" || move === null) return false;
  const m = move as Partial<ChessMove>;
  if (m.type !== "move") return false;
  if (typeof m.from !== "string" || typeof m.to !== "string") return false;
  if (!/^[a-h][1-8]$/.test(m.from) || !/^[a-h][1-8]$/.test(m.to)) return false;
  return m.promotion === undefined || ["q", "r", "b", "n"].includes(m.promotion);
}

/** Translates chess.js's terminal-state predicates into a platform verdict. */
function detectEnd(game: Chess): { finished: boolean; drawn: boolean; reason: ChessEndReason } {
  if (game.isCheckmate()) return { finished: true, drawn: false, reason: "checkmate" };
  if (game.isStalemate()) return { finished: true, drawn: true, reason: "stalemate" };
  if (game.isInsufficientMaterial()) {
    return { finished: true, drawn: true, reason: "insufficient-material" };
  }
  if (game.isThreefoldRepetition()) {
    return { finished: true, drawn: true, reason: "threefold-repetition" };
  }
  // isDraw() also covers the fifty-move rule once the other cases are ruled out.
  if (game.isDraw()) return { finished: true, drawn: true, reason: "fifty-move" };
  return { finished: false, drawn: false, reason: null };
}

function boardMatrix(game: Chess): (string | null)[][] {
  return game.board().map((row) => row.map((cell) => (cell ? `${cell.color}${cell.type}` : null)));
}

export const chessModule: GameModule<ChessState, ChessMove, ChessPlayerView> = {
  meta: {
    id: "chess",
    name: "Chess",
    tagline: "The real thing — castling, en passant, promotion and all.",
    minPlayers: 2,
    maxPlayers: 2,
    hasHiddenState: false,
    estimatedMinutes: 20,
    variants: CHESS_VARIANTS.map((v) => ({ id: v.id, name: v.name, description: v.description })),
    variantOptionKey: "variant",
  },

  createInitialState(players: string[], options: GameOptions = {}): ChessState {
    const rules = getChessVariant(options.variant as string | undefined);
    const game = new Chess();
    return {
      rules,
      fen: game.fen(),
      history: [],
      players: [
        { id: players[0]!, color: "w" },
        { id: players[1]!, color: "b" },
      ],
      finished: false,
      winners: [],
      drawn: false,
      endReason: null,
      clock: rules.clock.enabled
        ? { w: rules.clock.initialSeconds * 1000, b: rules.clock.initialSeconds * 1000 }
        : null,
      turnStartedAt: rules.clock.enabled ? Date.now() : null,
      lastMove: null,
    };
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished) return false;
    if (!isChessMove(move)) return false;

    const seat = state.players.find((p) => p.id === playerId);
    if (!seat) return false;

    const game = load(state);
    if (game.turn() !== seat.color) return false;

    // Legality is chess.js's verdict, not ours: ask for the legal moves from
    // this square and check the target is among them.
    const candidates = game.moves({ square: move.from as never, verbose: true }) as unknown as Array<{
      to: string;
      promotion?: string;
    }>;
    return candidates.some(
      (c) => c.to === move.to && (c.promotion === undefined || c.promotion === (move.promotion ?? "q"))
    );
  },

  applyMove(state, playerId, move): ApplyResult<ChessState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const next: ChessState = structuredClone(state);
    const events: GameEvent[] = [];
    const game = load(next);
    const mover = game.turn();

    const played = game.move({ from: move.from, to: move.to, promotion: move.promotion ?? "q" });
    if (!played) throw new Error("illegal move");

    next.fen = game.fen();
    next.history = [...next.history, played.san];
    next.lastMove = { from: played.from, to: played.to };

    // Clock accounting: charge the thinking time, then add the increment.
    if (next.clock && next.turnStartedAt !== null) {
      const spent = Date.now() - next.turnStartedAt;
      next.clock[mover] = Math.max(0, next.clock[mover] - spent + next.rules.clock.incrementSeconds * 1000);
      next.turnStartedAt = Date.now();
      if (next.clock[mover] === 0) {
        next.finished = true;
        next.endReason = "timeout";
        next.winners = next.players.filter((p) => p.color !== mover).map((p) => p.id);
        events.push({ type: "flag", playerId, text: "runs out of time" });
        return { state: next, events };
      }
    }

    events.push({
      type: "move",
      playerId,
      text: played.san,
      data: { san: played.san, from: played.from, to: played.to },
    });
    if (played.captured) {
      events.push({ type: "capture", playerId, text: `takes on ${played.to}` });
    }

    const end = detectEnd(game);
    if (game.isCheck() && !end.finished) {
      events.push({ type: "check", playerId, text: "gives check" });
    }

    if (end.finished) {
      next.finished = true;
      next.drawn = end.drawn;
      next.endReason = end.reason;
      next.winners = end.drawn ? [] : next.players.filter((p) => p.color === mover).map((p) => p.id);
      events.push({
        type: end.drawn ? "draw" : "gameOver",
        playerId: end.drawn ? undefined : next.winners[0],
        text: end.drawn ? `drawn — ${end.reason?.replace(/-/g, " ")}` : "delivers checkmate",
      });
    }

    return { state: next, events };
  },

  /** Chess hides nothing: every viewer gets the same position. */
  getPlayerView(state, playerId): ChessPlayerView {
    const game = load(state);
    const seat = playerId ? state.players.find((p) => p.id === playerId) ?? null : null;
    const isMyTurn = !state.finished && seat?.color === game.turn();

    const verbose = isMyTurn
      ? (game.moves({ verbose: true }) as unknown as Array<{
          from: string;
          to: string;
          san: string;
          promotion?: string;
          captured?: string;
        }>)
      : [];

    return {
      rulesId: state.rules.id,
      rulesName: state.rules.name,
      fen: state.fen,
      board: boardMatrix(game),
      history: state.history,
      players: state.players,
      turn: game.turn(),
      currentPlayerId: state.finished
        ? null
        : state.players.find((p) => p.color === game.turn())?.id ?? null,
      legalMoves: verbose.map((m) => ({
        from: m.from,
        to: m.to,
        san: m.san,
        promotion: m.promotion,
        captured: m.captured,
      })),
      inCheck: game.isCheck(),
      finished: state.finished,
      winners: state.winners,
      drawn: state.drawn,
      endReason: state.endReason,
      clock: state.clock,
      myColor: seat?.color ?? null,
      lastMove: state.lastMove,
    };
  },

  checkWinCondition(state): WinCondition | null {
    if (!state.finished) return null;
    // A draw is finished with nobody winning.
    return { finished: true, winners: state.winners };
  },

  getCurrentPlayerId(state): string | null {
    if (state.finished) return null;
    const game = load(state);
    return state.players.find((p) => p.color === game.turn())?.id ?? null;
  },

  /** Timing out plays a legal move rather than silently conceding. */
  getTimeoutMove(state, playerId): ChessMove | null {
    if (state.finished) return null;
    const game = load(state);
    const seat = state.players.find((p) => p.id === playerId);
    if (!seat || seat.color !== game.turn()) return null;
    const moves = game.moves({ verbose: true }) as unknown as Array<{ from: string; to: string; promotion?: string }>;
    const first = moves[0];
    if (!first) return null;
    return {
      type: "move",
      from: first.from,
      to: first.to,
      ...(first.promotion ? { promotion: first.promotion as ChessMove["promotion"] } : {}),
    };
  },

  getEliminatedPlayers(): string[] {
    return [];
  },
};
