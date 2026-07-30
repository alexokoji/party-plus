import { applyAction, createGame, totalDice } from "../src/engine/game";
import { randomAction } from "../src/engine/agent";
import { mulberry32 } from "../src/engine/rng";
import { GameState } from "../src/engine/types";

const NUM_MATCHES = Number(process.argv[2] ?? 1000);
const PLAYERS_PER_MATCH = 4;
const MAX_ACTIONS = 5000; // guards against an infinite-loop bug hanging the sim

let matchesPlayed = 0;
let totalActions = 0;
const roundsPerMatch: number[] = [];

for (let m = 0; m < NUM_MATCHES; m++) {
  const seed = m + 1;
  const playerIds = Array.from({ length: PLAYERS_PER_MATCH }, (_, i) => `p${i}`);
  let state: GameState = createGame(playerIds, seed);
  const actionRng = mulberry32(seed * 999331 + 7);

  const startingTotal = totalDice(state);
  let actions = 0;

  while (state.phase !== "gameOver") {
    if (actions++ > MAX_ACTIONS) {
      throw new Error(`match ${m} (seed ${seed}) did not terminate within ${MAX_ACTIONS} actions`);
    }
    const action = randomAction(state, actionRng);
    const before = state;
    state = applyAction(state, action);

    // Invariant: dice only ever decrease by exactly 1 per challenge, never during a bid.
    if (action.type === "challenge") {
      if (totalDice(state) !== totalDice(before) - 1) {
        throw new Error(`match ${m}: dice count changed by more than 1 after challenge`);
      }
    } else {
      if (totalDice(state) !== totalDice(before)) {
        throw new Error(`match ${m}: dice count changed during a bid`);
      }
    }
  }

  if (totalDice(state) >= startingTotal) {
    throw new Error(`match ${m}: no dice were lost across the whole match`);
  }
  const winners = state.players.filter((p) => !p.eliminated);
  if (winners.length !== 1) {
    throw new Error(`match ${m}: expected exactly 1 winner, got ${winners.length}`);
  }
  if (state.winnerId !== winners[0]!.id) {
    throw new Error(`match ${m}: winnerId mismatch`);
  }

  matchesPlayed++;
  totalActions += actions;
  roundsPerMatch.push(state.history.length);
}

const avgRounds = roundsPerMatch.reduce((a, b) => a + b, 0) / roundsPerMatch.length;
const avgActions = totalActions / matchesPlayed;

console.log(`Simulated ${matchesPlayed} matches, all terminated with exactly one winner.`);
console.log(`Average challenge-rounds per match: ${avgRounds.toFixed(2)}`);
console.log(`Average actions per match: ${avgActions.toFixed(2)}`);
