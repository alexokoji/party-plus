import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";
import { consumeRoll, createDiceState, rollFor, type DiceState } from "../shared/serverDice";
import {
  BOARD_SIZE,
  destinationOf,
  getSnakesVariant,
  SNAKES_VARIANTS,
  type SnakesRules,
} from "./rules";

export type SnakesMove = { type: "roll" };

export interface SnakesToken {
  id: string;
  /** 0 = off the board (not yet started), 1..100 on the board. */
  square: number;
  finished: boolean;
}

export interface SnakesState extends DiceState {
  rules: SnakesRules;
  players: SnakesToken[];
  currentIndex: number;
  consecutiveExtras: number;
  seed: number;
  finished: boolean;
  winners: string[];
  finishOrder: string[];
  /** The last hop taken, so the client can animate the slide or climb. */
  lastMove: {
    playerId: string;
    from: number;
    steppedTo: number;
    finalSquare: number;
    kind: "move" | "ladder" | "snake" | "blocked";
  } | null;
}

export interface SnakesPlayerView {
  rulesId: string;
  rulesName: string;
  boardSize: number;
  ladders: Record<number, number>;
  snakes: Record<number, number>;
  players: Array<{ id: string; square: number; finished: boolean }>;
  currentPlayerId: string | null;
  dice: number | null;
  lastRoll: number | null;
  lastRollBy: string | null;
  rollCount: number;
  mustRoll: boolean;
  requireExactFinish: boolean;
  lastMove: SnakesState["lastMove"];
  finished: boolean;
  winners: string[];
  finishOrder: string[];
}

const isRoll = (move: unknown): move is SnakesMove =>
  typeof move === "object" && move !== null && (move as { type?: unknown }).type === "roll";

function advanceTurn(state: SnakesState): void {
  const n = state.players.length;
  let next = state.currentIndex;
  for (let i = 0; i < n; i++) {
    next = (next + 1) % n;
    if (!state.players[next]!.finished) break;
  }
  state.currentIndex = next;
  consumeRoll(state);
  state.consecutiveExtras = 0;
}

export const snakesModule: GameModule<SnakesState, SnakesMove, SnakesPlayerView> = {
  meta: {
    id: "snakes",
    name: "Snakes & Ladders",
    tagline: "Pure luck, pure betrayal. Ride the ladders, dread square 98.",
    minPlayers: 2,
    maxPlayers: 4,
    // Nothing is hidden: the board, the tokens and every roll are public.
    category: "board",
    modes: ["room"],
    hasHiddenState: false,
    estimatedMinutes: 10,
    variants: SNAKES_VARIANTS.map((v) => ({ id: v.id, name: v.name, description: v.description })),
    variantOptionKey: "variant",
  },

  createInitialState(players: string[], options: GameOptions = {}): SnakesState {
    const rules = getSnakesVariant(options.variant as string | undefined);
    const seed = typeof options.seed === "number" ? options.seed : Math.floor(Math.random() * 2 ** 31);

    return {
      rules,
      players: players.map((id) => ({ id, square: 0, finished: false })),
      currentIndex: 0,
      ...createDiceState(seed),
      consecutiveExtras: 0,
      seed,
      finished: false,
      winners: [],
      finishOrder: [],
      lastMove: null,
    };
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished) return false;
    if (state.players[state.currentIndex]?.id !== playerId) return false;
    // Rolling is the only move: everything after it is forced.
    return isRoll(move) && state.dice === null;
  },

  applyMove(state, playerId, move): ApplyResult<SnakesState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const next: SnakesState = structuredClone(state);
    const events: GameEvent[] = [];
    const token = next.players[next.currentIndex]!;

    // Server-side roll, same pattern as Ludo: the move carries no number.
    const roll = rollFor(next, playerId);
    events.push({ type: "roll", playerId, text: `rolled ${roll}`, data: { roll } });

    const from = token.square;
    const target = from + roll;
    let steppedTo = target;
    let finalSquare = target;
    let kind: NonNullable<SnakesState["lastMove"]>["kind"] = "move";

    if (target > BOARD_SIZE) {
      if (next.rules.requireExactFinish) {
        // Overshooting the finish: the token stays put.
        steppedTo = from;
        finalSquare = from;
        kind = "blocked";
        events.push({
          type: "blocked",
          playerId,
          text: `needs exactly ${BOARD_SIZE - from} — stays on ${from}`,
        });
      } else {
        steppedTo = BOARD_SIZE;
        finalSquare = BOARD_SIZE;
      }
    }

    if (kind !== "blocked") {
      const destination = destinationOf(steppedTo, next.rules);
      if (destination !== null) {
        finalSquare = destination;
        kind = destination > steppedTo ? "ladder" : "snake";
        events.push({
          type: kind,
          playerId,
          text:
            kind === "ladder"
              ? `climbs the ladder from ${steppedTo} to ${destination}`
              : `hits the snake on ${steppedTo} and slides to ${destination}`,
          data: { from: steppedTo, to: destination },
        });
      }
    }

    token.square = finalSquare;
    next.lastMove = { playerId, from, steppedTo, finalSquare, kind };

    if (finalSquare === BOARD_SIZE) {
      token.finished = true;
      next.finishOrder.push(playerId);
      events.push({ type: "home", playerId, text: `reaches ${BOARD_SIZE}!` });
    }

    // First one home wins; the rest keep their placing.
    const stillRacing = next.players.filter((p) => !p.finished);
    if (next.finishOrder.length >= 1 && stillRacing.length <= 1) {
      next.finished = true;
      for (const straggler of stillRacing) {
        if (!next.finishOrder.includes(straggler.id)) next.finishOrder.push(straggler.id);
      }
      next.winners = next.finishOrder.slice(0, 1);
      events.push({ type: "gameOver", playerId: next.winners[0], text: "wins the climb!" });
      return { state: next, events };
    }
    if (token.finished && next.winners.length === 0 && next.finishOrder.length === 1) {
      // Someone finished but others are still going: the race is decided.
      next.finished = true;
      for (const straggler of stillRacing) {
        if (!next.finishOrder.includes(straggler.id)) next.finishOrder.push(straggler.id);
      }
      next.winners = [next.finishOrder[0]!];
      events.push({ type: "gameOver", playerId: next.winners[0], text: "wins the climb!" });
      return { state: next, events };
    }

    const earnedExtra = next.rules.extraTurnRoll !== null && roll === next.rules.extraTurnRoll;
    if (earnedExtra && next.consecutiveExtras + 1 < next.rules.maxConsecutiveExtras) {
      next.consecutiveExtras += 1;
      consumeRoll(next); // same player rolls again
      events.push({ type: "extraTurn", playerId, text: "goes again" });
    } else {
      if (earnedExtra) {
        events.push({ type: "extrasForfeit", playerId, text: "too many sixes — turn forfeited" });
      }
      advanceTurn(next);
    }

    return { state: next, events };
  },

  /** Nothing is hidden, so every recipient gets the same board. */
  getPlayerView(state, playerId): SnakesPlayerView {
    const isCurrent = !state.finished && state.players[state.currentIndex]?.id === playerId;
    return {
      rulesId: state.rules.id,
      rulesName: state.rules.name,
      boardSize: BOARD_SIZE,
      ladders: state.rules.ladders,
      snakes: state.rules.snakes,
      players: state.players.map((p) => ({ id: p.id, square: p.square, finished: p.finished })),
      currentPlayerId: state.finished ? null : state.players[state.currentIndex]?.id ?? null,
      dice: state.dice,
      lastRoll: state.lastRoll,
      lastRollBy: state.lastRollBy,
      rollCount: state.rollCount,
      mustRoll: isCurrent && state.dice === null,
      requireExactFinish: state.rules.requireExactFinish,
      lastMove: state.lastMove,
      finished: state.finished,
      winners: state.winners,
      finishOrder: state.finishOrder,
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

  /** Time out and you lose the roll; the next player goes. */
  forfeitTurn(state, playerId): SnakesState | null {
    if (state.finished || state.players[state.currentIndex]?.id !== playerId) return null;
    const next: SnakesState = structuredClone(state);
    advanceTurn(next);
    return next;
  },

  getTimeoutMove(state, playerId): SnakesMove | null {
    if (state.finished || state.players[state.currentIndex]?.id !== playerId) return null;
    // There is only ever one move, so an absent player loses nothing but time.
    return { type: "roll" };
  },

  getEliminatedPlayers(state): string[] {
    return state.players.filter((p) => p.finished).map((p) => p.id);
  },
};
