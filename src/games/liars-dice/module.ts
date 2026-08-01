import { applyAction, createGame, InvalidActionError, isValidBidTransition } from "../../engine/game";
import { chooseAction } from "../../engine/ai";
import type { Bid, Face, GameState, RoundResult } from "../../engine/types";
import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";

export type LiarsDiceMove = { type: "bid"; bid: Bid } | { type: "challenge" };

/** A die as a given client is entitled to see it: null face = not yours. */
export interface DieView {
  id: string;
  ownerId: string;
  face: Face | null;
}

export interface LiarsDicePlayerView {
  players: Array<{ id: string; diceCount: number; eliminated: boolean }>;
  /** Only ever this recipient's own dice. */
  myDice: Face[];
  dice: DieView[];
  currentBid: Bid | null;
  currentPlayerId: string | null;
  round: number;
  palifico: boolean;
  finished: boolean;
  winnerId: string | null;
  lastResult: RoundResult | null;
  /** Full challenge history: public once revealed, and needed for the report. */
  history: RoundResult[];
  /** True when this recipient may see everyone's dice (out, or spectating). */
  seesAllHands: boolean;
}

function isBidMove(move: unknown): move is { type: "bid"; bid: Bid } {
  if (typeof move !== "object" || move === null) return false;
  const m = move as { type?: unknown; bid?: unknown };
  if (m.type !== "bid" || typeof m.bid !== "object" || m.bid === null) return false;
  const bid = m.bid as { quantity?: unknown; face?: unknown };
  return (
    Number.isInteger(bid.quantity) &&
    (bid.quantity as number) >= 1 &&
    Number.isInteger(bid.face) &&
    (bid.face as number) >= 1 &&
    (bid.face as number) <= 6
  );
}

function isChallengeMove(move: unknown): move is { type: "challenge" } {
  return typeof move === "object" && move !== null && (move as { type?: unknown }).type === "challenge";
}

function activePlayers(state: GameState) {
  return state.players.filter((p) => !p.eliminated);
}

/**
 * Liar's Dice (Perudo) as a platform game module.
 *
 * All rules live here or in ../../engine — the room Durable Object contains
 * no game logic at all. The engine is reused unchanged, so the exhaustively
 * tested rules (turn order, palifico, wild ones, elimination) are the same
 * ones running under the new interface.
 */
export const liarsDiceModule: GameModule<GameState, LiarsDiceMove, LiarsDicePlayerView> = {
  meta: {
    id: "liars-dice",
    name: "Liar's Dice",
    tagline: "Bluff about dice nobody else can see. Call the liars.",
    minPlayers: 2,
    maxPlayers: 6,
    category: "party",
    modes: ["room", "solo"],
    hasHiddenState: true,
    estimatedMinutes: 15,
  },

  createInitialState(players: string[], options: GameOptions = {}): GameState {
    const seed = typeof options.seed === "number" ? options.seed : Math.floor(Math.random() * 2 ** 31);
    return createGame(players, seed);
  },

  validateMove(state, playerId, move): boolean {
    if (state.phase === "gameOver") return false;
    const actor = state.players[state.currentPlayerIndex];
    if (!actor || actor.id !== playerId || actor.eliminated) return false;

    if (isChallengeMove(move)) return state.currentBid !== null;
    if (!isBidMove(move)) return false;
    return isValidBidTransition(state.currentBid, move.bid, state.palifico);
  },

  applyMove(state, playerId, move): ApplyResult<GameState> {
    if (!this.validateMove(state, playerId, move)) {
      throw new InvalidActionError("illegal move");
    }

    const before = state;
    const next = isChallengeMove(move)
      ? applyAction(state, { type: "challenge", playerId })
      : applyAction(state, { type: "bid", playerId, bid: (move as { bid: Bid }).bid });

    const events: GameEvent[] = [];

    if (isBidMove(move)) {
      events.push({
        type: "bid",
        playerId,
        text: `bid ${move.bid.quantity} × ${move.bid.face}`,
        data: { quantity: move.bid.quantity, face: move.bid.face },
      });
    } else {
      const result = next.history[next.history.length - 1];
      if (result) {
        events.push({
          type: "challenge",
          playerId,
          text: `called bluff on ${result.bidderId}`,
          data: { bidderId: result.bidderId, bid: result.bid },
        });
        // The reveal is public by the rules of the game: every hand is shown
        // when a challenge resolves, so putting it in an event is safe.
        events.push({
          type: "reveal",
          text: `there were ${result.actualCount} — ${result.loserId} loses a die`,
          data: {
            actualCount: result.actualCount,
            loserId: result.loserId,
            bidderWon: result.bidderWon,
            allHands: result.allHands,
            round: result.round,
          },
        });
        const loser = next.players.find((p) => p.id === result.loserId);
        if (loser?.eliminated) {
          events.push({ type: "eliminated", playerId: loser.id, text: "is out!" });
        }
      }
    }

    if (next.round !== before.round && next.phase === "bidding") {
      events.push({
        type: "round",
        text: next.palifico ? `Round ${next.round} — PALIFICO` : `Round ${next.round}`,
        data: { round: next.round, palifico: next.palifico },
      });
    }

    if (next.phase === "gameOver") {
      events.push({ type: "gameOver", playerId: next.winnerId ?? undefined, text: "wins the match!" });
    }

    return { state: next, events };
  },

  /**
   * The redaction chokepoint.
   *
   * Built by explicitly listing the fields a recipient may have, rather than
   * copying state and deleting secrets — the latter leaks the moment a new
   * field is added to GameState. A player sees only their own dice; someone
   * who has been eliminated, or who never held a seat, may see everything,
   * because they can no longer act on it.
   */
  getPlayerView(state, playerId): LiarsDicePlayerView {
    const me = playerId ? state.players.find((p) => p.id === playerId) ?? null : null;
    const seesAllHands = playerId === null || (me?.eliminated ?? false);

    const dice: DieView[] = state.players
      .filter((p) => !p.eliminated)
      .flatMap((p) =>
        p.dice.map((face, i) => ({
          id: `${p.id}-${i}`,
          ownerId: p.id,
          face: seesAllHands || p.id === playerId ? face : null,
        }))
      );

    return {
      players: state.players.map((p) => ({
        id: p.id,
        diceCount: p.diceCount,
        eliminated: p.eliminated,
      })),
      myDice: me && !me.eliminated ? [...me.dice] : [],
      dice,
      currentBid: state.currentBid,
      currentPlayerId: state.players[state.currentPlayerIndex]?.id ?? null,
      round: state.round,
      palifico: state.palifico,
      finished: state.phase === "gameOver",
      winnerId: state.winnerId,
      lastResult: state.history.length ? state.history[state.history.length - 1]! : null,
      history: state.history,
      seesAllHands,
    };
  },

  checkWinCondition(state): WinCondition | null {
    if (state.phase !== "gameOver") return null;
    return { finished: true, winners: state.winnerId ? [state.winnerId] : [] };
  },

  getCurrentPlayerId(state): string | null {
    if (state.phase === "gameOver") return null;
    return state.players[state.currentPlayerIndex]?.id ?? null;
  },

  /**
   * Plays a sensible move for an absent player. chooseAction only ever reads
   * the acting seat's own hand, so the server is not exploiting hidden state
   * it would not grant a human in the same seat.
   */
  getTimeoutMove(state, playerId): LiarsDiceMove | null {
    if (state.phase === "gameOver") return null;
    const actor = state.players[state.currentPlayerIndex];
    if (!actor || actor.id !== playerId) return null;
    try {
      const action = chooseAction(state, playerId, Math.random, "casual");
      return action.type === "bid" ? { type: "bid", bid: action.bid } : { type: "challenge" };
    } catch {
      return null;
    }
  },

  getEliminatedPlayers(state): string[] {
    return state.players.filter((p) => p.eliminated).map((p) => p.id);
  },
};

/** Total dice still on the table — handy for clients sizing the felt. */
export function totalDiceInPlay(view: LiarsDicePlayerView): number {
  return view.players.reduce((sum, p) => sum + p.diceCount, 0);
}

export { activePlayers };
