import { applyAction, createGame } from "../src/engine/game";
import { randomAction } from "../src/engine/agent";
import { mulberry32 } from "../src/engine/rng";
import { GameState } from "../src/engine/types";

/**
 * Plays one full match with random-legal-move agents, deterministic from
 * `seed`. Stands in for a real finished room's state until the live
 * DO-backed results endpoint exists — the results page below only cares
 * about consuming a finished GameState, so swapping this for a fetch from
 * the room later is a one-line change.
 */
export function playDemoMatch(seed: number, playerCount = 4): GameState {
  const playerIds = Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
  let state = createGame(playerIds, seed);
  const actionRng = mulberry32(seed * 999331 + 7);

  let guard = 0;
  while (state.phase !== "gameOver" && guard++ < 5000) {
    const action = randomAction(state, actionRng);
    state = applyAction(state, action);
  }
  return state;
}
