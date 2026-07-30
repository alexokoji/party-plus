import { Action, Bid, DICE_FACES, GameState } from "./types";
import { isValidBidTransition } from "./game";
import { randInt } from "./rng";

/**
 * Picks a random legal action for the current player: either challenge
 * (only when a bid exists) or a random valid raise. Used to stress-test
 * the reducer, not as a real opponent.
 */
export function randomAction(state: GameState, rng: () => number): Action {
  const player = state.players[state.currentPlayerIndex]!;
  const totalDiceInPlay = state.players.reduce((s, p) => s + p.diceCount, 0);

  const candidates: Bid[] = [];
  for (const face of DICE_FACES) {
    // Quantity search bounded by total dice in play + a small margin so the
    // search space stays finite while still exploring "obviously bad" bids.
    for (let q = 1; q <= totalDiceInPlay + 2; q++) {
      const bid = { quantity: q, face };
      if (isValidBidTransition(state.currentBid, bid, state.palifico)) candidates.push(bid);
    }
  }

  const canChallenge = state.currentBid !== null;
  // Weight challenge like any other candidate move so games terminate.
  const options: Action[] = candidates.map((bid) => ({ type: "bid", playerId: player.id, bid }));
  if (canChallenge) options.push({ type: "challenge", playerId: player.id });

  const idx = randInt(rng, 0, options.length - 1);
  return options[idx]!;
}
