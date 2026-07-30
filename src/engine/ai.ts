import { binomialAtLeast } from "./probability";
import { isValidBidTransition } from "./game";
import type { Action, Bid, Face, GameState } from "./types";
import { DICE_FACES } from "./types";

export type Difficulty = "casual" | "sharp";

/** Chance a single unknown die matches a bid on `face`, given the wild-ones rule. */
export function matchProbability(face: Face, wildOnesActive: boolean): number {
  if (face === 1 || !wildOnesActive) return 1 / 6;
  return 2 / 6;
}

/** How many of `hand` already count toward a bid on `face`. */
export function countOwnMatches(hand: Face[], face: Face, wildOnesActive: boolean): number {
  let count = 0;
  for (const die of hand) {
    if (die === face) count++;
    else if (wildOnesActive && die === 1 && face !== 1) count++;
  }
  return count;
}

/**
 * Probability a bid is true from a seat that knows only its own hand.
 * Everyone else's dice are unknown, so they're modelled as independent
 * binomial trials.
 */
export function bidTruthProbability(
  bid: Bid,
  ownHand: Face[],
  totalDiceInPlay: number,
  wildOnesActive: boolean
): number {
  const own = countOwnMatches(ownHand, bid.face, wildOnesActive);
  const unknownDice = totalDiceInPlay - ownHand.length;
  const stillNeeded = Math.max(0, bid.quantity - own);
  return binomialAtLeast(unknownDice, stillNeeded, matchProbability(bid.face, wildOnesActive));
}

/** Bids at most this far above what's already claimed; keeps the search bounded. */
const QUANTITY_LOOKAHEAD = 3;

function candidateBids(state: GameState): Bid[] {
  const totalDice = state.players.reduce((sum, p) => sum + p.diceCount, 0);
  const maxQuantity = Math.min(totalDice, (state.currentBid?.quantity ?? 0) + QUANTITY_LOOKAHEAD);
  const bids: Bid[] = [];
  for (const face of DICE_FACES) {
    for (let quantity = 1; quantity <= maxQuantity; quantity++) {
      const bid = { quantity, face };
      if (isValidBidTransition(state.currentBid, bid, state.palifico)) bids.push(bid);
    }
  }
  return bids;
}

/**
 * Picks a move for the player to act, using only information that seat is
 * entitled to — its own dice and the public bid history. It never inspects
 * opponents' hands, so it can safely run server-side in the room DO without
 * leaking hidden state into its decisions.
 *
 * Strategy: challenge when the standing bid looks unlikely, otherwise make
 * the boldest bid that still holds up probabilistically. "casual" tolerates
 * worse odds and bluffs more, "sharp" plays closer to the math.
 */
export function chooseAction(state: GameState, playerId: string, rng: () => number = Math.random, difficulty: Difficulty = "sharp"): Action {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`unknown player ${playerId}`);

  const totalDice = state.players.reduce((sum, p) => sum + p.diceCount, 0);
  const wildOnes = !state.palifico;

  // Below this confidence the AI would rather call the bluff than raise.
  const challengeThreshold = difficulty === "sharp" ? 0.34 : 0.22;
  // Bids it is willing to make; lower means more willing to bluff.
  const bidThreshold = difficulty === "sharp" ? 0.42 : 0.3;

  if (state.currentBid) {
    const standing = bidTruthProbability(state.currentBid, player.dice, totalDice, wildOnes);
    if (standing < challengeThreshold) {
      return { type: "challenge", playerId };
    }
  }

  const options = candidateBids(state)
    .map((bid) => ({ bid, p: bidTruthProbability(bid, player.dice, totalDice, wildOnes) }))
    .filter((o) => o.p >= bidThreshold)
    // Prefer the strongest claim among acceptable-risk bids: raising pressure
    // is the whole game, and a timid minimum raise just hands over tempo.
    .sort((a, b) => b.bid.quantity - a.bid.quantity || b.p - a.p);

  if (options.length === 0) {
    // Nothing safe to say. Challenge if allowed, else make the safest legal bid.
    if (state.currentBid) return { type: "challenge", playerId };
    const fallback = candidateBids(state)
      .map((bid) => ({ bid, p: bidTruthProbability(bid, player.dice, totalDice, wildOnes) }))
      .sort((a, b) => b.p - a.p)[0];
    return { type: "bid", playerId, bid: fallback!.bid };
  }

  // Occasional bluff from the riskier tail, so the AI isn't perfectly readable.
  const bluffChance = difficulty === "sharp" ? 0.15 : 0.3;
  if (options.length > 1 && rng() < bluffChance) {
    const risky = options[options.length - 1]!;
    return { type: "bid", playerId, bid: risky.bid };
  }

  return { type: "bid", playerId, bid: options[0]!.bid };
}
