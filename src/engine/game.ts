import { Action, Bid, DICE_FACES, Face, GameState, PlayerState, RoundResult, STARTING_DICE } from "./types";
import { mulberry32, randInt } from "./rng";

export class InvalidActionError extends Error {}

function rollDice(rng: () => number, count: number): Face[] {
  const dice: Face[] = [];
  for (let i = 0; i < count; i++) dice.push(DICE_FACES[randInt(rng, 0, 5)]!);
  return dice;
}

function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.eliminated);
}

function isPalificoRound(state: GameState): boolean {
  return activePlayers(state).some((p) => p.diceCount === 1);
}

/** Creates a new game and rolls the opening hands. First bidder is players[0]. */
export function createGame(playerIds: string[], seed: number): GameState {
  if (playerIds.length < 2) throw new InvalidActionError("need at least 2 players");
  const rng = mulberry32(seed);
  const players: PlayerState[] = playerIds.map((id) => ({
    id,
    diceCount: STARTING_DICE,
    dice: rollDice(rng, STARTING_DICE),
    eliminated: false,
  }));
  const state: GameState = {
    players,
    currentPlayerIndex: 0,
    currentBid: null,
    bidderIndex: null,
    round: 1,
    palifico: false,
    phase: "bidding",
    winnerId: null,
    history: [],
    rngSeed: seed,
  };
  state.palifico = isPalificoRound(state);
  return state;
}

function nextActiveIndex(state: GameState, fromIndex: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n;
    if (!state.players[idx]!.eliminated) return idx;
  }
  throw new InvalidActionError("no active players remain");
}

/** True if `next` is a legal successor bid to `prev` under the current round's wild-ones rule. */
export function isValidBidTransition(prev: Bid | null, next: Bid, palifico: boolean): boolean {
  if (next.quantity < 1) return false;
  if (prev === null) return true;

  const prevIsOnes = prev.face === 1;
  const nextIsOnes = next.face === 1;

  if (palifico) {
    // Palifico: face is fixed for the whole round; only quantity may rise.
    return next.face === prev.face && next.quantity > prev.quantity;
  }

  if (!prevIsOnes && nextIsOnes) {
    // Switching to ones: standard Perudo halving rule (round up).
    const minQty = Math.floor(prev.quantity / 2) + 1;
    return next.quantity >= minQty;
  }
  if (prevIsOnes && !nextIsOnes) {
    // Switching off ones: must at least double + 1.
    const minQty = prev.quantity * 2 + 1;
    return next.quantity >= minQty;
  }
  // Same "lane" (both ones or both non-ones): quantity must strictly increase,
  // or quantity stays same with a strictly higher face.
  if (next.quantity > prev.quantity) return true;
  if (next.quantity === prev.quantity && next.face > prev.face) return true;
  return false;
}

function countMatches(hands: Face[][], bid: Bid, wildOnesActive: boolean): number {
  let count = 0;
  for (const hand of hands) {
    for (const die of hand) {
      if (die === bid.face) count++;
      else if (wildOnesActive && die === 1 && bid.face !== 1) count++;
    }
  }
  return count;
}

function checkGameOver(state: GameState): void {
  const remaining = activePlayers(state);
  if (remaining.length === 1) {
    state.phase = "gameOver";
    state.winnerId = remaining[0]!.id;
  }
}

/** Pure reducer: returns a new GameState. Throws InvalidActionError on illegal moves. */
export function applyAction(state: GameState, action: Action): GameState {
  if (state.phase === "gameOver") throw new InvalidActionError("game already over");

  const actingPlayer = state.players[state.currentPlayerIndex]!;
  if (actingPlayer.id !== action.playerId) {
    throw new InvalidActionError(`not ${action.playerId}'s turn`);
  }

  if (action.type === "bid") {
    if (!isValidBidTransition(state.currentBid, action.bid, state.palifico)) {
      throw new InvalidActionError("illegal bid transition");
    }
    const next = structuredClone(state);
    next.currentBid = action.bid;
    next.bidderIndex = next.currentPlayerIndex;
    next.currentPlayerIndex = nextActiveIndex(next, next.currentPlayerIndex);
    return next;
  }

  // challenge
  if (state.currentBid === null || state.bidderIndex === null) {
    throw new InvalidActionError("no bid to challenge");
  }
  const next = structuredClone(state);
  const bidderIdx = next.bidderIndex!;
  const bidder = next.players[bidderIdx]!;
  const challenger = next.players[next.currentPlayerIndex]!;
  const bid = next.currentBid!;

  const wildOnesActive = !next.palifico;
  const hands = next.players.filter((p) => !p.eliminated).map((p) => p.dice);
  const actualCount = countMatches(hands, bid, wildOnesActive);
  const bidderWon = actualCount >= bid.quantity;
  const loser = bidderWon ? challenger : bidder;

  const roundResult: RoundResult = {
    round: next.round,
    bid,
    bidderId: bidder.id,
    challengerId: challenger.id,
    actualCount,
    wildOnesCounted: wildOnesActive,
    bidderWon,
    loserId: loser.id,
    allHands: Object.fromEntries(next.players.filter((p) => !p.eliminated).map((p) => [p.id, p.dice])),
  };
  next.history.push(roundResult);

  loser.diceCount -= 1;
  if (loser.diceCount <= 0) {
    loser.diceCount = 0;
    loser.dice = [];
    loser.eliminated = true;
  }

  next.round += 1;
  next.currentBid = null;
  next.bidderIndex = null;

  checkGameOver(next);
  if (next.phase === "gameOver") return next;

  // Reroll all remaining players' dice for the new round.
  const rng = mulberry32(next.rngSeed + next.round);
  for (const p of next.players) {
    if (!p.eliminated) p.dice = rollDice(rng, p.diceCount);
  }
  next.palifico = isPalificoRound(next);

  // Round starts with the loser (Perudo convention). If the loser was eliminated,
  // the next active player in turn order starts instead.
  const loserIdx = next.players.findIndex((p) => p.id === loser.id);
  next.currentPlayerIndex = loser.eliminated ? nextActiveIndex(next, loserIdx) : loserIdx;

  return next;
}

/** Total dice remaining in play, used as a sim invariant check. */
export function totalDice(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.diceCount, 0);
}
