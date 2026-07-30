import { rollDie } from "../../engine/rng";

/**
 * Server-authoritative dice, shared by Ludo and Snakes & Ladders.
 *
 * The pattern: the client sends a move carrying *no number at all*, the server
 * draws from a serialisable PRNG stream held in game state, and publishes the
 * result for the client to animate. There is nothing for a tampered client to
 * forge, and a match replays identically from its seed.
 */
export interface DiceState {
  /** Serialisable PRNG state, advanced once per roll. */
  rngState: number;
  /** Roll awaiting use, or null when the player still has to roll. */
  dice: number | null;
  /**
   * Most recent roll, retained for display after `dice` is consumed or the
   * turn passes — otherwise a player who rolls with no legal move never sees
   * what they got.
   */
  lastRoll: number | null;
  lastRollBy: string | null;
  /** Increments on every roll, so clients can trigger a fresh animation. */
  rollCount: number;
}

export function createDiceState(seed: number): DiceState {
  return { rngState: seed >>> 0, dice: null, lastRoll: null, lastRollBy: null, rollCount: 0 };
}

/** Rolls for `playerId`, mutating the dice fields on `state` in place. */
export function rollFor<T extends DiceState>(state: T, playerId: string, sides = 6): number {
  const { value, state: rngState } = rollDie(state.rngState, sides);
  state.rngState = rngState;
  state.dice = value;
  state.lastRoll = value;
  state.lastRollBy = playerId;
  state.rollCount += 1;
  return value;
}

/** Clears the pending roll while leaving `lastRoll` visible. */
export function consumeRoll<T extends DiceState>(state: T): void {
  state.dice = null;
}
