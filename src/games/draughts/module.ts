import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";
import {
  BOARD,
  DRAUGHTS_VARIANTS,
  getDraughtsVariant,
  isPlayableSquare,
  onBoard,
  type DraughtsRules,
} from "./rules";

export type Side = "light" | "dark";

export interface Piece {
  side: Side;
  king: boolean;
}

/** null = empty square. Index as board[row][col], row 0 at the top. */
export type Board = (Piece | null)[][];

export interface DraughtsMove {
  type: "move";
  from: [number, number];
  to: [number, number];
}

export interface CaptureStep {
  from: [number, number];
  to: [number, number];
  /** Square of the piece being jumped, or null for a plain move. */
  captured: [number, number] | null;
}

export interface DraughtsState {
  rules: DraughtsRules;
  board: Board;
  players: { id: string; side: Side }[];
  turn: Side;
  /**
   * Set while a multi-jump is in progress: that piece, and only that piece,
   * must keep capturing until it can no longer do so.
   */
  chaining: [number, number] | null;
  /** Plies since the last capture or promotion, for the draw rule. */
  quietPlies: number;
  finished: boolean;
  winners: string[];
  drawn: boolean;
  lastMove: CaptureStep | null;
}

export interface DraughtsPlayerView {
  rulesId: string;
  rulesName: string;
  board: Board;
  players: { id: string; side: Side; pieces: number; kings: number }[];
  turn: Side;
  currentPlayerId: string | null;
  /** Every move the player to act may make — the UI needs no rules of its own. */
  legalMoves: DraughtsMove[];
  /** True when a capture is available and therefore compulsory. */
  captureRequired: boolean;
  chaining: [number, number] | null;
  lastMove: CaptureStep | null;
  finished: boolean;
  winners: string[];
  drawn: boolean;
  mySide: Side | null;
}

const other = (side: Side): Side => (side === "light" ? "dark" : "light");

/** Light moves up the board (decreasing row); dark moves down. */
const forwardOf = (side: Side): number => (side === "light" ? -1 : 1);

function emptyBoard(): Board {
  return Array.from({ length: BOARD }, () => Array.from({ length: BOARD }, () => null));
}

export function initialBoard(): Board {
  const board = emptyBoard();
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < BOARD; col++) {
      if (isPlayableSquare(row, col)) board[row]![col] = { side: "dark", king: false };
    }
  }
  for (let row = BOARD - 3; row < BOARD; row++) {
    for (let col = 0; col < BOARD; col++) {
      if (isPlayableSquare(row, col)) board[row]![col] = { side: "light", king: false };
    }
  }
  return board;
}

const pieceAt = (board: Board, [r, c]: [number, number]): Piece | null =>
  onBoard(r, c) ? board[r]![c] ?? null : null;

/** Diagonal directions a piece may travel for a plain move. */
function moveDirections(piece: Piece): Array<[number, number]> {
  if (piece.king) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const fwd = forwardOf(piece.side);
  return [[fwd, -1], [fwd, 1]];
}

/** Diagonal directions a piece may capture along. */
function captureDirections(piece: Piece, rules: DraughtsRules): Array<[number, number]> {
  if (piece.king || rules.menCaptureBackwards) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const fwd = forwardOf(piece.side);
  return [[fwd, -1], [fwd, 1]];
}

/** All captures available to the piece on `square`. */
export function capturesFrom(state: DraughtsState, square: [number, number]): CaptureStep[] {
  const piece = pieceAt(state.board, square);
  if (!piece) return [];
  const [r, c] = square;
  const steps: CaptureStep[] = [];
  const flying = piece.king && state.rules.flyingKings;

  for (const [dr, dc] of captureDirections(piece, state.rules)) {
    if (!flying) {
      const overR = r + dr;
      const overC = c + dc;
      const landR = r + dr * 2;
      const landC = c + dc * 2;
      const over = pieceAt(state.board, [overR, overC]);
      if (!onBoard(landR, landC)) continue;
      if (!over || over.side === piece.side) continue;
      if (state.board[landR]![landC] !== null) continue;
      steps.push({ from: square, to: [landR, landC], captured: [overR, overC] });
      continue;
    }

    // Flying king: scan along the diagonal for exactly one enemy piece, then
    // any number of empty squares beyond it.
    let rr = r + dr;
    let cc = c + dc;
    while (onBoard(rr, cc) && state.board[rr]![cc] === null) {
      rr += dr;
      cc += dc;
    }
    const victim = pieceAt(state.board, [rr, cc]);
    if (!victim || victim.side === piece.side) continue;
    let lr = rr + dr;
    let lc = cc + dc;
    while (onBoard(lr, lc) && state.board[lr]![lc] === null) {
      steps.push({ from: square, to: [lr, lc], captured: [rr, cc] });
      lr += dr;
      lc += dc;
    }
  }
  return steps;
}

/** Plain (non-capturing) moves available to the piece on `square`. */
function quietMovesFrom(state: DraughtsState, square: [number, number]): CaptureStep[] {
  const piece = pieceAt(state.board, square);
  if (!piece) return [];
  const [r, c] = square;
  const out: CaptureStep[] = [];
  const flying = piece.king && state.rules.flyingKings;

  for (const [dr, dc] of moveDirections(piece)) {
    let rr = r + dr;
    let cc = c + dc;
    while (onBoard(rr, cc) && state.board[rr]![cc] === null) {
      out.push({ from: square, to: [rr, cc], captured: null });
      if (!flying) break;
      rr += dr;
      cc += dc;
    }
  }
  return out;
}

/** How many pieces a chain starting with `step` can take, at most. */
function chainLength(state: DraughtsState, step: CaptureStep): number {
  const { state: after, promoted } = applyStep(state, step, /* forChainSearch */ true);
  const piece = pieceAt(after.board, step.to);
  // A promotion ends the chain under standard rules.
  if (!piece || (promoted && state.rules.promotionEndsTurn)) return 1;
  const nexts = capturesFrom(after, step.to);
  if (nexts.length === 0) return 1;
  return 1 + Math.max(...nexts.map((n) => chainLength(after, n)));
}

/**
 * Every legal move for the side to act.
 *
 * This is the single source of truth for legality: validateMove just checks
 * membership, and the view publishes it so the UI never re-derives the rules.
 */
export function legalMoves(state: DraughtsState): DraughtsMove[] {
  if (state.finished) return [];

  // Mid-chain: only the chaining piece may act, and only by capturing.
  if (state.chaining) {
    return capturesFrom(state, state.chaining).map(toMove);
  }

  const captures: CaptureStep[] = [];
  const quiet: CaptureStep[] = [];

  for (let r = 0; r < BOARD; r++) {
    for (let c = 0; c < BOARD; c++) {
      const piece = state.board[r]![c];
      if (!piece || piece.side !== state.turn) continue;
      captures.push(...capturesFrom(state, [r, c]));
      quiet.push(...quietMovesFrom(state, [r, c]));
    }
  }

  if (captures.length > 0 && state.rules.mandatoryCapture) {
    if (!state.rules.mustTakeMaximum) return captures.map(toMove);
    // Maximum-capture rule: only the longest chains are legal.
    const lengths = captures.map((step) => chainLength(state, step));
    const best = Math.max(...lengths);
    return captures.filter((_, i) => lengths[i] === best).map(toMove);
  }

  return [...captures, ...quiet].map(toMove);
}

const toMove = (step: CaptureStep): DraughtsMove => ({ type: "move", from: step.from, to: step.to });

const sameSquare = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

/** Finds the capture/quiet step matching a requested move. */
function stepFor(state: DraughtsState, move: DraughtsMove): CaptureStep | null {
  const candidates = state.chaining
    ? capturesFrom(state, state.chaining)
    : [...capturesFrom(state, move.from), ...quietMovesFrom(state, move.from)];
  return candidates.find((s) => sameSquare(s.from, move.from) && sameSquare(s.to, move.to)) ?? null;
}

/** Applies one step to a copy of the state, reporting whether it promoted. */
function applyStep(
  state: DraughtsState,
  step: CaptureStep,
  forChainSearch = false
): { state: DraughtsState; promoted: boolean } {
  const next: DraughtsState = forChainSearch
    ? { ...state, board: state.board.map((row) => row.slice()) }
    : structuredClone(state);

  const piece = next.board[step.from[0]]![step.from[1]]!;
  next.board[step.from[0]]![step.from[1]] = null;
  if (step.captured) next.board[step.captured[0]]![step.captured[1]] = null;

  const backRow = piece.side === "light" ? 0 : BOARD - 1;
  const promoted = !piece.king && step.to[0] === backRow;
  next.board[step.to[0]]![step.to[1]] = { side: piece.side, king: piece.king || promoted };

  return { state: next, promoted };
}

function countPieces(board: Board, side: Side) {
  let pieces = 0;
  let kings = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell?.side !== side) continue;
      pieces++;
      if (cell.king) kings++;
    }
  }
  return { pieces, kings };
}

/** Decides the outcome after a move, if the game has ended. */
function settle(state: DraughtsState, events: GameEvent[]): void {
  const toAct = state.turn;
  const { pieces } = countPieces(state.board, toAct);
  const stuck = legalMoves(state).length === 0;

  if (pieces === 0 || stuck) {
    state.finished = true;
    const winnerSide = other(toAct);
    state.winners = state.players.filter((p) => p.side === winnerSide).map((p) => p.id);
    events.push({
      type: "gameOver",
      playerId: state.winners[0],
      text: pieces === 0 ? "takes every piece and wins" : "wins — opponent has no legal moves",
    });
    return;
  }

  // Long stretches with no capture or promotion are a draw.
  if (state.quietPlies >= 80) {
    state.finished = true;
    state.drawn = true;
    state.winners = [];
    events.push({ type: "draw", text: "drawn — 40 moves without a capture" });
  }
}

export const draughtsModule: GameModule<DraughtsState, DraughtsMove, DraughtsPlayerView> = {
  meta: {
    id: "draughts",
    name: "Draughts",
    tagline: "Checkers, with compulsory captures and the long jumps that come with them.",
    minPlayers: 2,
    maxPlayers: 2,
    hasHiddenState: false,
    estimatedMinutes: 15,
    variants: DRAUGHTS_VARIANTS.map((v) => ({ id: v.id, name: v.name, description: v.description })),
    variantOptionKey: "variant",
  },

  createInitialState(players: string[], options: GameOptions = {}): DraughtsState {
    const rules = getDraughtsVariant(options.variant as string | undefined);
    return {
      rules,
      board: initialBoard(),
      // Seat order decides colours; light moves first, as in the paper rules.
      players: [
        { id: players[0]!, side: "light" },
        { id: players[1]!, side: "dark" },
      ],
      turn: "light",
      chaining: null,
      quietPlies: 0,
      finished: false,
      winners: [],
      drawn: false,
      lastMove: null,
    };
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished) return false;
    if (typeof move !== "object" || move === null) return false;
    const m = move as Partial<DraughtsMove>;
    if (m.type !== "move" || !Array.isArray(m.from) || !Array.isArray(m.to)) return false;
    if (m.from.length !== 2 || m.to.length !== 2) return false;
    if (![...m.from, ...m.to].every((n) => Number.isInteger(n) && n >= 0 && n < BOARD)) return false;

    const seat = state.players.find((p) => p.id === playerId);
    if (!seat || seat.side !== state.turn) return false;

    const piece = pieceAt(state.board, m.from as [number, number]);
    if (!piece || piece.side !== seat.side) return false;

    // Legality — including the forced-capture rule — is decided by membership
    // of the generated move list, so there is exactly one implementation.
    return legalMoves(state).some(
      (legal) => sameSquare(legal.from, m.from as [number, number]) && sameSquare(legal.to, m.to as [number, number])
    );
  },

  applyMove(state, playerId, move): ApplyResult<DraughtsState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const step = stepFor(state, move)!;
    const { state: next, promoted } = applyStep(state, step);
    const events: GameEvent[] = [];

    next.lastMove = step;
    if (step.captured) {
      next.quietPlies = 0;
      events.push({
        type: "capture",
        playerId,
        text: `captures on ${squareName(step.captured)}`,
        data: { square: step.captured },
      });
    } else {
      next.quietPlies += 1;
      events.push({
        type: "move",
        playerId,
        text: `${squareName(step.from)} → ${squareName(step.to)}`,
      });
    }

    if (promoted) {
      next.quietPlies = 0;
      events.push({ type: "crowned", playerId, text: `crowns a king on ${squareName(step.to)}` });
    }

    // Multi-jump: the same piece must keep going while it can.
    const chainContinues =
      !!step.captured &&
      !(promoted && next.rules.promotionEndsTurn) &&
      capturesFrom(next, step.to).length > 0;

    if (chainContinues) {
      next.chaining = step.to;
      events.push({ type: "chain", playerId, text: "must jump again" });
    } else {
      next.chaining = null;
      next.turn = other(next.turn);
    }

    settle(next, events);
    return { state: next, events };
  },

  /** Draughts is an open-information game: everyone sees the same board. */
  getPlayerView(state, playerId): DraughtsPlayerView {
    const seat = playerId ? state.players.find((p) => p.id === playerId) ?? null : null;
    const isMyTurn = !state.finished && seat?.side === state.turn;
    const moves = legalMoves(state);

    return {
      rulesId: state.rules.id,
      rulesName: state.rules.name,
      board: state.board,
      players: state.players.map((p) => {
        const counted = countPieces(state.board, p.side);
        return { id: p.id, side: p.side, pieces: counted.pieces, kings: counted.kings };
      }),
      turn: state.turn,
      currentPlayerId: state.finished
        ? null
        : state.players.find((p) => p.side === state.turn)?.id ?? null,
      legalMoves: isMyTurn ? moves : [],
      captureRequired: moves.length > 0 && moves.every((m) => isCapture(state, m)),
      chaining: state.chaining,
      lastMove: state.lastMove,
      finished: state.finished,
      winners: state.winners,
      drawn: state.drawn,
      mySide: seat?.side ?? null,
    };
  },

  checkWinCondition(state): WinCondition | null {
    if (!state.finished) return null;
    return { finished: true, winners: state.winners };
  },

  getCurrentPlayerId(state): string | null {
    if (state.finished) return null;
    return state.players.find((p) => p.side === state.turn)?.id ?? null;
  },

  /**
   * No forfeit: skipping a turn in a two-player abstract just hands the game
   * over silently. A timeout plays a legal move instead.
   */
  getTimeoutMove(state, playerId): DraughtsMove | null {
    if (state.finished) return null;
    const seat = state.players.find((p) => p.id === playerId);
    if (!seat || seat.side !== state.turn) return null;
    return legalMoves(state)[0] ?? null;
  },

  getEliminatedPlayers(): string[] {
    return [];
  },
};

function isCapture(state: DraughtsState, move: DraughtsMove): boolean {
  return Math.abs(move.to[0] - move.from[0]) > 1;
}

/** Standard algebraic-ish square name, for readable event text. */
export function squareName([row, col]: [number, number]): string {
  return `${"abcdefgh"[col]}${BOARD - row}`;
}

export { legalMoves as draughtsLegalMoves, other as otherSide };
