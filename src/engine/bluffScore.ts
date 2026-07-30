import { binomialAtLeast } from "./probability";
import { Bid, Face, GameState, RoundResult } from "./types";

const BLUFF_THRESHOLD = 0.4;

export type BidVerdict = "bluff-succeeded" | "bluff-caught" | "honest-bid" | "bad-beat";

export interface BluffScoreEntry {
  round: number;
  bidderId: string;
  challengerId: string;
  bid: Bid;
  actualCount: number;
  bidderWon: boolean;
  /** P(bid true) using only public info: total dice in play, no hand knowledge. */
  probabilityPublic: number;
  /** P(bid true) from the bidder's seat: their own dice are known, others aren't. */
  probabilityBidderView: number;
  /** P(bid true) from the challenger's seat: their own dice are known, others aren't. */
  probabilityChallengerView: number;
  /** How much of a bluff this was, from the bidder's own vantage point (0 = certain truth, 1 = certain lie). */
  bluffSeverity: number;
  verdict: BidVerdict;
}

export interface PlayerBluffSummary {
  playerId: string;
  bidsMade: number;
  avgBluffSeverity: number;
  bluffsSucceeded: number;
  bluffsCaught: number;
  honestBids: number;
  challengesMade: number;
  challengesCorrect: number; // challenger's read matched the outcome
}

export interface PostMatchReport {
  rounds: BluffScoreEntry[];
  players: PlayerBluffSummary[];
  winnerId: string | null;
}

function matchProbability(face: Face, wildOnesCounted: boolean): number {
  if (face === 1 || !wildOnesCounted) return 1 / 6;
  return 2 / 6;
}

function countOwnMatches(hand: Face[], bid: Bid, wildOnesCounted: boolean): number {
  let count = 0;
  for (const die of hand) {
    if (die === bid.face) count++;
    else if (wildOnesCounted && die === 1 && bid.face !== 1) count++;
  }
  return count;
}

/** P(bid true) as seen by `observerId`: their own hand is known, everyone else's isn't. */
function probabilityFromPerspective(result: RoundResult, observerId: string): number {
  const allHandSizes = Object.values(result.allHands).reduce((sum, h) => sum + h.length, 0);
  const ownHand = result.allHands[observerId] ?? [];
  const ownMatches = countOwnMatches(ownHand, result.bid, result.wildOnesCounted);
  const unknownDice = allHandSizes - ownHand.length;
  const unknownNeeded = Math.max(0, result.bid.quantity - ownMatches);
  const p = matchProbability(result.bid.face, result.wildOnesCounted);
  return binomialAtLeast(unknownDice, unknownNeeded, p);
}

/** P(bid true) using only public information (total dice count, no hand knowledge). */
function probabilityPublicInfo(result: RoundResult): number {
  const totalDice = Object.values(result.allHands).reduce((sum, h) => sum + h.length, 0);
  const p = matchProbability(result.bid.face, result.wildOnesCounted);
  return binomialAtLeast(totalDice, result.bid.quantity, p);
}

function scoreRound(result: RoundResult): BluffScoreEntry {
  const probabilityPublic = probabilityPublicInfo(result);
  const probabilityBidderView = probabilityFromPerspective(result, result.bidderId);
  const probabilityChallengerView = probabilityFromPerspective(result, result.challengerId);
  const bluffSeverity = 1 - probabilityBidderView;
  const isBluff = probabilityBidderView < BLUFF_THRESHOLD;

  let verdict: BidVerdict;
  if (isBluff && result.bidderWon) verdict = "bluff-succeeded";
  else if (isBluff && !result.bidderWon) verdict = "bluff-caught";
  else if (!isBluff && result.bidderWon) verdict = "honest-bid";
  else verdict = "bad-beat";

  return {
    round: result.round,
    bidderId: result.bidderId,
    challengerId: result.challengerId,
    bid: result.bid,
    actualCount: result.actualCount,
    bidderWon: result.bidderWon,
    probabilityPublic,
    probabilityBidderView,
    probabilityChallengerView,
    bluffSeverity,
    verdict,
  };
}

function summarizePlayers(playerIds: string[], rounds: BluffScoreEntry[]): PlayerBluffSummary[] {
  return playerIds.map((playerId) => {
    const bidsByPlayer = rounds.filter((r) => r.bidderId === playerId);
    const challengesByPlayer = rounds.filter((r) => r.challengerId === playerId);

    const avgBluffSeverity =
      bidsByPlayer.length === 0
        ? 0
        : bidsByPlayer.reduce((sum, r) => sum + r.bluffSeverity, 0) / bidsByPlayer.length;

    // A challenge is "correct" if the challenger's own view gave the bid a
    // low chance of being true and they were right, or a high chance and
    // they were right not to have bid it themselves (challenging is always
    // the higher-EV move when probabilityChallengerView < 0.5).
    const challengesCorrect = challengesByPlayer.filter(
      (r) => (r.probabilityChallengerView < 0.5) === !r.bidderWon
    ).length;

    return {
      playerId,
      bidsMade: bidsByPlayer.length,
      avgBluffSeverity,
      bluffsSucceeded: bidsByPlayer.filter((r) => r.verdict === "bluff-succeeded").length,
      bluffsCaught: bidsByPlayer.filter((r) => r.verdict === "bluff-caught").length,
      honestBids: bidsByPlayer.filter((r) => r.verdict === "honest-bid" || r.verdict === "bad-beat").length,
      challengesMade: challengesByPlayer.length,
      challengesCorrect,
    };
  });
}

/** Builds the post-match bluff report from a finished (or in-progress) game's history. */
export function buildPostMatchReport(state: GameState): PostMatchReport {
  const rounds = state.history.map(scoreRound);
  const playerIds = state.players.map((p) => p.id);
  return {
    rounds,
    players: summarizePlayers(playerIds, rounds),
    winnerId: state.winnerId,
  };
}
