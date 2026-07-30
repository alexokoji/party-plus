import { consumeRoll, createDiceState, rollFor, type DiceState } from "../shared/serverDice";
import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";
import {
  absoluteSquare,
  COLORS,
  getLudoVariant,
  HOME_PROGRESS,
  isSafeSquare,
  LUDO_VARIANTS,
  PAWNS_PER_PLAYER,
  TRACK_LENGTH,
  type LudoColor,
  type LudoRules,
} from "./rules";

export type LudoMove = { type: "roll" } | { type: "movePawn"; pawn: number } | { type: "pass" };

export interface LudoPawn {
  /** -1 while in base, otherwise 0..57 (57 = home). */
  progress: number;
  inBase: boolean;
  home: boolean;
}

export interface LudoPlayerState {
  id: string;
  color: LudoColor;
  pawns: LudoPawn[];
}

export interface LudoState extends DiceState {
  rules: LudoRules;
  players: LudoPlayerState[];
  currentIndex: number;
  /** Consecutive extra turns taken, to stop a six-chain running forever. */
  consecutiveExtras: number;
  seed: number;
  finished: boolean;
  winners: string[];
  /** Ranking as players finish, so 2nd and 3rd place are recorded. */
  finishOrder: string[];
}

export interface LudoPawnView {
  progress: number;
  inBase: boolean;
  home: boolean;
  /** Absolute track square, or null when in base or the home column. */
  square: number | null;
}

export interface LudoPlayerView {
  rulesId: string;
  rulesName: string;
  players: Array<{ id: string; color: LudoColor; pawns: LudoPawnView[]; pawnsHome: number }>;
  currentPlayerId: string | null;
  dice: number | null;
  /** Most recent roll, shown even once it has been used or the turn passed. */
  lastRoll: number | null;
  lastRollBy: string | null;
  /** Pawn indices the player to act may legally move with the current roll. */
  movablePawns: number[];
  mustRoll: boolean;
  finished: boolean;
  winners: string[];
  finishOrder: string[];
  /** Bumped whenever a new roll lands, so the client can trigger its animation. */
  rollCount: number;
  safeSquaresEnabled: boolean;
}

function isRoll(move: unknown): move is { type: "roll" } {
  return typeof move === "object" && move !== null && (move as { type?: unknown }).type === "roll";
}

function isPass(move: unknown): move is { type: "pass" } {
  return typeof move === "object" && move !== null && (move as { type?: unknown }).type === "pass";
}

function isMovePawn(move: unknown): move is { type: "movePawn"; pawn: number } {
  if (typeof move !== "object" || move === null) return false;
  const m = move as { type?: unknown; pawn?: unknown };
  return m.type === "movePawn" && Number.isInteger(m.pawn) && (m.pawn as number) >= 0 && (m.pawn as number) < PAWNS_PER_PLAYER;
}

/** Target progress for a pawn given a roll, or null when the move is illegal. */
function targetProgress(pawn: LudoPawn, roll: number, rules: LudoRules): number | null {
  if (pawn.home) return null;

  if (pawn.inBase) {
    return roll === rules.exitRoll ? 0 : null;
  }

  const target = pawn.progress + roll;
  if (target > HOME_PROGRESS) {
    // Overshooting home: illegal under exact-finish rules, otherwise clamp.
    return rules.requireExactFinish ? null : HOME_PROGRESS;
  }
  return target;
}

/** Indices of pawns the given seat may move with `roll`. */
function movablePawns(state: LudoState, seatIndex: number, roll: number): number[] {
  const player = state.players[seatIndex];
  if (!player) return [];
  const out: number[] = [];

  player.pawns.forEach((pawn, i) => {
    const target = targetProgress(pawn, roll, state.rules);
    if (target === null) return;

    // A pawn may not land on a square already holding one of your own pawns,
    // unless that square is off the shared track.
    const square = absoluteSquare(seatIndex, target);
    if (square !== null) {
      const ownThere = player.pawns.some(
        (other, j) => j !== i && !other.inBase && !other.home && absoluteSquare(seatIndex, other.progress) === square
      );
      if (ownThere) return;

      if (state.rules.blockingEnabled && isBlockedPath(state, seatIndex, pawn, target)) return;
    }
    out.push(i);
  });

  return out;
}

/** True when an opponent block sits between a pawn's current and target square. */
function isBlockedPath(state: LudoState, seatIndex: number, pawn: LudoPawn, target: number): boolean {
  const from = pawn.inBase ? 0 : pawn.progress + 1;
  for (let p = from; p <= Math.min(target, TRACK_LENGTH - 1); p++) {
    const square = absoluteSquare(seatIndex, p);
    if (square === null) continue;
    for (const [otherSeat, other] of state.players.entries()) {
      if (otherSeat === seatIndex) continue;
      const count = other.pawns.filter(
        (op) => !op.inBase && !op.home && absoluteSquare(otherSeat, op.progress) === square
      ).length;
      if (count >= 2) return true;
    }
  }
  return false;
}

function playerFinished(player: LudoPlayerState): boolean {
  return player.pawns.every((p) => p.home);
}

function advanceTurn(state: LudoState): void {
  const n = state.players.length;
  let next = state.currentIndex;
  for (let i = 0; i < n; i++) {
    next = (next + 1) % n;
    if (!playerFinished(state.players[next]!)) break;
  }
  state.currentIndex = next;
  // Clears the *pending* roll; lastRoll deliberately survives so the table can
  // still show what was rolled after the turn moves on.
  consumeRoll(state);
  state.consecutiveExtras = 0;
}

export const ludoModule: GameModule<LudoState, LudoMove, LudoPlayerView> = {
  meta: {
    id: "ludo",
    name: "Ludo",
    tagline: "Race four pawns home. Send your friends back to base on the way.",
    minPlayers: 2,
    maxPlayers: 4,
    // Ludo is an open-information game: everything on the board is public and
    // the dice result is published the moment it is rolled. This exercises the
    // platform's non-hidden path.
    hasHiddenState: false,
    estimatedMinutes: 20,
    variants: LUDO_VARIANTS.map((v) => ({ id: v.id, name: v.name, description: v.description })),
    variantOptionKey: "variant",
  },

  createInitialState(players: string[], options: GameOptions = {}): LudoState {
    const rules = getLudoVariant(options.variant as string | undefined);
    const seed = typeof options.seed === "number" ? options.seed : Math.floor(Math.random() * 2 ** 31);

    return {
      rules,
      players: players.map((id, i) => ({
        id,
        color: COLORS[i % COLORS.length]!,
        pawns: Array.from({ length: PAWNS_PER_PLAYER }, () => ({
          progress: -1,
          inBase: true,
          home: false,
        })),
      })),
      currentIndex: 0,
      ...createDiceState(seed),
      consecutiveExtras: 0,
      seed,
      finished: false,
      winners: [],
      finishOrder: [],
    };
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished) return false;
    if (state.players[state.currentIndex]?.id !== playerId) return false;

    if (isRoll(move)) return state.dice === null;

    if (isPass(move)) {
      // Passing is only legal once a roll has landed with nothing to move.
      return state.dice !== null && movablePawns(state, state.currentIndex, state.dice).length === 0;
    }

    if (!isMovePawn(move)) return false;
    if (state.dice === null) return false;
    return movablePawns(state, state.currentIndex, state.dice).includes(move.pawn);
  },

  applyMove(state, playerId, move): ApplyResult<LudoState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const next: LudoState = structuredClone(state);
    const events: GameEvent[] = [];
    const seatIndex = next.currentIndex;
    const player = next.players[seatIndex]!;

    // ---- roll ----
    if (isRoll(move)) {
      // Rolled server-side from a single serialisable PRNG stream, so a match
      // replays identically from its seed. The client only ever receives the
      // outcome to animate — it never rolls anything itself.
      const roll = rollFor(next, playerId);

      events.push({ type: "roll", playerId, text: `rolled ${roll}`, data: { roll } });

      const options = movablePawns(next, seatIndex, roll);

      if (options.length === 0) {
        events.push({ type: "noMove", playerId, text: `rolled ${roll} — nothing to move` });
        // A six with no move still costs the turn, which also prevents an
        // infinite chain when every pawn is blocked.
        advanceTurn(next);
        return { state: next, events };
      }

      // Exactly one legal move is not a choice — play it now so the turn
      // passes on immediately instead of waiting for a mandatory second click.
      if (options.length === 1 && next.rules.autoMoveWhenForced) {
        const forced = this.applyMove(next, playerId, { type: "movePawn", pawn: options[0]! });
        return { state: forced.state, events: [...events, ...forced.events] };
      }

      return { state: next, events };
    }

    // ---- pass (no legal move) ----
    if (isPass(move)) {
      advanceTurn(next);
      return { state: next, events };
    }

    // ---- move a pawn ----
    const roll = next.dice!;
    const pawnIndex = (move as { pawn: number }).pawn;
    const pawn = player.pawns[pawnIndex]!;
    const wasInBase = pawn.inBase;
    const target = targetProgress(pawn, roll, next.rules)!;

    pawn.inBase = false;
    pawn.progress = target;

    if (wasInBase) {
      events.push({ type: "leaveBase", playerId, text: "brought a pawn out" });
    }

    let captured = false;

    if (target >= HOME_PROGRESS) {
      pawn.home = true;
      pawn.progress = HOME_PROGRESS;
      events.push({ type: "pawnHome", playerId, text: "got a pawn home" });
    } else {
      const square = absoluteSquare(seatIndex, target);
      if (square !== null && !isSafeSquare(square, next.rules)) {
        // Send any opponents on this square back to base.
        for (const [otherSeat, other] of next.players.entries()) {
          if (otherSeat === seatIndex) continue;
          for (const opponentPawn of other.pawns) {
            if (opponentPawn.inBase || opponentPawn.home) continue;
            if (absoluteSquare(otherSeat, opponentPawn.progress) !== square) continue;
            opponentPawn.inBase = true;
            opponentPawn.progress = -1;
            captured = true;
            events.push({
              type: "capture",
              playerId,
              text: `sent ${other.id} back to base`,
              data: { victimId: other.id, square },
            });
          }
        }
      }
    }

    // Did this finish the player?
    if (playerFinished(player) && !next.finishOrder.includes(player.id)) {
      next.finishOrder.push(player.id);
      events.push({ type: "playerHome", playerId, text: "is home with all four pawns!" });
    }

    const stillRacing = next.players.filter((p) => !playerFinished(p));
    if (stillRacing.length <= 1) {
      next.finished = true;
      // Winner is the first to get everyone home; stragglers keep their order.
      for (const straggler of stillRacing) {
        if (!next.finishOrder.includes(straggler.id)) next.finishOrder.push(straggler.id);
      }
      next.winners = next.finishOrder.slice(0, 1);
      events.push({ type: "gameOver", playerId: next.winners[0], text: "wins the race!" });
      return { state: next, events };
    }

    // Extra turns: rolling the magic number, or capturing.
    const earnedExtra =
      roll === next.rules.extraTurnRoll || (captured && next.rules.extraTurnOnCapture);

    if (earnedExtra && next.consecutiveExtras + 1 < next.rules.maxConsecutiveExtraTurns) {
      next.consecutiveExtras += 1;
      consumeRoll(next); // same player rolls again
      events.push({ type: "extraTurn", playerId, text: "goes again" });
    } else {
      if (earnedExtra) {
        events.push({ type: "extrasForfeit", playerId, text: "rolled too many sixes — turn forfeited" });
      }
      advanceTurn(next);
    }

    return { state: next, events };
  },

  /**
   * Ludo has no hidden information: the board is open and the die is public
   * the moment the server rolls it. Every recipient gets the same view, which
   * is exactly what `hasHiddenState: false` promises.
   */
  getPlayerView(state, playerId): LudoPlayerView {
    const isCurrent = !state.finished && state.players[state.currentIndex]?.id === playerId;

    return {
      rulesId: state.rules.id,
      rulesName: state.rules.name,
      players: state.players.map((p, seat) => ({
        id: p.id,
        color: p.color,
        pawns: p.pawns.map((pawn) => ({
          progress: pawn.progress,
          inBase: pawn.inBase,
          home: pawn.home,
          square: pawn.inBase || pawn.home ? null : absoluteSquare(seat, pawn.progress),
        })),
        pawnsHome: p.pawns.filter((pawn) => pawn.home).length,
      })),
      currentPlayerId: state.finished ? null : state.players[state.currentIndex]?.id ?? null,
      dice: state.dice,
      lastRoll: state.lastRoll,
      lastRollBy: state.lastRollBy,
      movablePawns:
        isCurrent && state.dice !== null ? movablePawns(state, state.currentIndex, state.dice) : [],
      mustRoll: isCurrent && state.dice === null,
      finished: state.finished,
      winners: state.winners,
      finishOrder: state.finishOrder,
      rollCount: state.rollCount,
      safeSquaresEnabled: state.rules.safeSquaresEnabled,
    };
  },

  checkWinCondition(state): WinCondition | null {
    if (!state.finished) return null;
    return { finished: true, winners: state.winners };
  },

  getCurrentPlayerId(state): string | null {
    if (state.finished) return null;
    return state.players[state.currentIndex]?.id ?? null;
  },

  /**
   * Running out of time costs the turn outright — no pawn is moved on the
   * player's behalf, and play passes on immediately.
   */
  forfeitTurn(state, playerId): LudoState | null {
    if (state.finished || state.players[state.currentIndex]?.id !== playerId) return null;
    const next: LudoState = structuredClone(state);
    advanceTurn(next);
    return next;
  },

  getTimeoutMove(state, playerId): LudoMove | null {
    if (state.finished || state.players[state.currentIndex]?.id !== playerId) return null;
    if (state.dice === null) return { type: "roll" };
    const options = movablePawns(state, state.currentIndex, state.dice);
    if (options.length === 0) return { type: "pass" };
    // Prefer a capture, then the furthest-along pawn — a plausible default
    // rather than a strong strategy.
    return { type: "movePawn", pawn: options[options.length - 1]! };
  },

  getEliminatedPlayers(state): string[] {
    // Players who are home stop acting but stay to watch the rest finish.
    return state.players.filter((p) => p.pawns.every((pawn) => pawn.home)).map((p) => p.id);
  },
};

export { movablePawns, targetProgress };
