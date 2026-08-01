import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";
import { redactHands } from "../shared/hiddenHand";
import { buildDeck, cardId, cardLabel, shuffleDeck, type Card, type Suit } from "../holdem/cards";
import {
  CRAZY8S_VARIANTS,
  getCrazy8sVariant,
  type Crazy8sRules,
} from "./rules";

const SUITS: Suit[] = ["s", "h", "d", "c"];

export type Crazy8sMove =
  | { type: "play"; cardId: string; declareSuit?: Suit }
  | { type: "draw" }
  | { type: "pass" }
  | { type: "announce" }
  | { type: "callOut"; targetId: string };

export interface Crazy8sPlayerState {
  id: string;
  hand: Card[];
  /** Whether they have called "last card" while holding one. */
  announced: boolean;
}

export interface Crazy8sState {
  rules: Crazy8sRules;
  players: Crazy8sPlayerState[];
  stock: Card[];
  /** Discard pile; last element is the face-up top card. */
  pile: Card[];
  currentIndex: number;
  /** +1 clockwise, -1 after a reverse. */
  direction: 1 | -1;
  /** Suit demanded by a wild card, overriding the top card's own suit. */
  declaredSuit: Suit | null;
  /** Accumulated draw-two debt owed by the player to act. */
  pendingDraw: number;
  /** Cards drawn this turn, so "draw until playable" cannot loop forever. */
  drawnThisTurn: number;
  rngState: number;
  shuffleCount: number;
  finished: boolean;
  winners: string[];
}

export interface Crazy8sOpponentView {
  id: string;
  cardCount: number;
  announced: boolean;
}

export interface Crazy8sPlayerView {
  rulesId: string;
  rulesName: string;
  /** Only ever this recipient's own hand. */
  myHand: Card[];
  /** Counts only — never the cards themselves. */
  opponents: Crazy8sOpponentView[];
  topCard: Card | null;
  /** The suit in force: the declared one after a wild, else the top card's. */
  activeSuit: Suit | null;
  stockCount: number;
  pileCount: number;
  currentPlayerId: string | null;
  direction: 1 | -1;
  pendingDraw: number;
  /** Card ids in `myHand` that are legal right now. Empty when not your turn. */
  playableCardIds: string[];
  /** True when this player holds one card and has not yet announced. */
  shouldAnnounce: boolean;
  /** Opponents who are on one card without announcing — callable. */
  callableIds: string[];
  mustAnnounceLastCard: boolean;
  finished: boolean;
  winners: string[];
  seesAllHands: boolean;
  allHands: Record<string, Card[]>;
}

const isSuit = (value: unknown): value is Suit => typeof value === "string" && SUITS.includes(value as Suit);

function isPlayMove(move: unknown): move is { type: "play"; cardId: string; declareSuit?: Suit } {
  if (typeof move !== "object" || move === null) return false;
  const m = move as { type?: unknown; cardId?: unknown; declareSuit?: unknown };
  if (m.type !== "play" || typeof m.cardId !== "string") return false;
  return m.declareSuit === undefined || isSuit(m.declareSuit);
}

const isType = (move: unknown, type: string): boolean =>
  typeof move === "object" && move !== null && (move as { type?: unknown }).type === type;

function isCallOut(move: unknown): move is { type: "callOut"; targetId: string } {
  if (!isType(move, "callOut")) return false;
  return typeof (move as { targetId?: unknown }).targetId === "string";
}

const topOf = (state: Crazy8sState): Card | null => state.pile[state.pile.length - 1] ?? null;
const playerOf = (state: Crazy8sState, id: string) => state.players.find((p) => p.id === id) ?? null;

/** The suit that must be matched: a declared suit wins over the card's own. */
export function activeSuit(state: Crazy8sState): Suit | null {
  return state.declaredSuit ?? topOf(state)?.suit ?? null;
}

/** Whether `card` may be played on the current top card. */
export function canPlay(card: Card, state: Crazy8sState): boolean {
  const top = topOf(state);
  if (!top) return false;
  // A wild is always playable.
  if (state.rules.wildRank !== null && card.rank === state.rules.wildRank) return true;
  const suit = activeSuit(state);
  // After a wild the demand is a suit, so rank no longer matches.
  if (state.declaredSuit) return card.suit === suit;
  return card.suit === top.suit || card.rank === top.rank;
}

/** Cards the given player may legally put down right now. */
export function playableCards(state: Crazy8sState, playerId: string): Card[] {
  const player = playerOf(state, playerId);
  if (!player) return [];

  // Under a draw-two debt only another draw-two answers, and only if the
  // variant allows stacking.
  if (state.pendingDraw > 0) {
    const rank = state.rules.drawTwoRank;
    if (!state.rules.stackDrawTwo || rank === null) return [];
    return player.hand.filter((c) => c.rank === rank);
  }

  return player.hand.filter((c) => canPlay(c, state));
}

function reshuffleStock(state: Crazy8sState, events: GameEvent[]): boolean {
  if (state.pile.length <= 1) return false;
  const top = state.pile.pop()!;
  const shuffled = shuffleDeck(state.pile, state.rngState + 1000 + state.shuffleCount++);
  state.stock = shuffled.deck;
  state.rngState = shuffled.rngState;
  state.pile = [top];
  events.push({ type: "reshuffle", text: "stock ran out — discards reshuffled" });
  return true;
}

function drawCards(state: Crazy8sState, playerId: string, count: number, events: GameEvent[]): number {
  const player = playerOf(state, playerId);
  if (!player) return 0;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if (state.stock.length === 0 && !reshuffleStock(state, events)) break;
    const card = state.stock.pop();
    if (!card) break;
    player.hand.push(card);
    drawn++;
  }
  // Picking cards up means you are no longer on your last card.
  if (player.hand.length > 1) player.announced = false;
  return drawn;
}

function advance(state: Crazy8sState, steps = 1): void {
  const n = state.players.length;
  state.currentIndex = (((state.currentIndex + steps * state.direction) % n) + n) % n;
}

export const crazy8sModule: GameModule<Crazy8sState, Crazy8sMove, Crazy8sPlayerView> = {
  meta: {
    id: "crazy8s",
    name: "Crazy 8s",
    tagline: "Shed your hand. Eights are wild — call the suit and watch them squirm.",
    minPlayers: 2,
    maxPlayers: 6,
    category: "card",
    modes: ["room"],
    hasHiddenState: true,
    estimatedMinutes: 10,
    variants: CRAZY8S_VARIANTS.map((v) => ({ id: v.id, name: v.name, description: v.description })),
    variantOptionKey: "variant",
  },

  createInitialState(players: string[], options: GameOptions = {}): Crazy8sState {
    const rules = getCrazy8sVariant(options.variant as string | undefined);
    const seed = typeof options.seed === "number" ? options.seed : Math.floor(Math.random() * 2 ** 31);
    const shuffled = shuffleDeck(buildDeck(), seed >>> 0);
    const stock = shuffled.deck;

    const hands: Crazy8sPlayerState[] = players.map((id) => ({ id, hand: [], announced: false }));
    for (let i = 0; i < rules.handSize; i++) {
      for (const player of hands) {
        const card = stock.pop();
        if (card) player.hand.push(card);
      }
    }

    // The starting card must not be a wild — nobody has named a suit yet.
    let opening = stock.pop()!;
    const buffer: Card[] = [];
    while (opening && rules.wildRank !== null && opening.rank === rules.wildRank && stock.length) {
      buffer.push(opening);
      opening = stock.pop()!;
    }

    return {
      rules,
      players: hands,
      stock: [...buffer, ...stock],
      pile: [opening],
      currentIndex: 0,
      direction: 1,
      declaredSuit: null,
      pendingDraw: 0,
      drawnThisTurn: 0,
      rngState: shuffled.rngState,
      shuffleCount: 0,
      finished: false,
      winners: [],
    };
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished) return false;
    const player = playerOf(state, playerId);
    if (!player) return false;

    // Calling out a missed announcement is the one move you may make out of
    // turn — otherwise nobody could ever catch it.
    if (isCallOut(move)) {
      if (!state.rules.mustAnnounceLastCard) return false;
      const target = playerOf(state, move.targetId);
      return !!target && target.id !== playerId && target.hand.length === 1 && !target.announced;
    }

    if (state.players[state.currentIndex]?.id !== playerId) return false;

    if (isType(move, "announce")) {
      return state.rules.mustAnnounceLastCard && player.hand.length <= 2 && !player.announced;
    }

    if (isType(move, "draw")) {
      if (state.pendingDraw > 0) return true;
      if (state.rules.mustPlayIfAble && playableCards(state, playerId).length > 0) return false;
      // One draw per turn unless the variant draws until playable.
      return state.drawnThisTurn === 0 || state.rules.drawUntilPlayable;
    }

    if (isType(move, "pass")) {
      // Passing is only legal after drawing with nothing to play.
      return state.drawnThisTurn > 0 && playableCards(state, playerId).length === 0;
    }

    if (!isPlayMove(move)) return false;
    const card = player.hand.find((c) => cardId(c) === move.cardId);
    if (!card) return false;
    if (!playableCards(state, playerId).some((c) => cardId(c) === cardId(card))) return false;

    if (state.rules.wildRank !== null && card.rank === state.rules.wildRank) {
      return move.declareSuit === undefined || isSuit(move.declareSuit);
    }
    return true;
  },

  applyMove(state, playerId, move): ApplyResult<Crazy8sState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const next: Crazy8sState = structuredClone(state);
    const events: GameEvent[] = [];
    const player = playerOf(next, playerId)!;

    // ---- catch a missed announcement ----
    if (isCallOut(move)) {
      const target = playerOf(next, move.targetId)!;
      const drawn = drawCards(next, target.id, next.rules.missedAnnouncementPenalty, events);
      events.push({
        type: "caught",
        playerId,
        text: `caught ${target.id} on one card — they draw ${drawn}`,
        data: { targetId: target.id, drawn },
      });
      return { state: next, events };
    }

    // ---- announce last card ----
    if (isType(move, "announce")) {
      player.announced = true;
      events.push({ type: "announce", playerId, text: "calls last card!" });
      return { state: next, events };
    }

    // ---- draw ----
    if (isType(move, "draw")) {
      if (next.pendingDraw > 0) {
        const owed = next.pendingDraw;
        const drawn = drawCards(next, playerId, owed, events);
        next.pendingDraw = 0;
        next.drawnThisTurn = 0;
        events.push({ type: "penalty", playerId, text: `picks up ${drawn}`, data: { count: drawn } });
        advance(next);
        return { state: next, events };
      }

      const count = next.rules.drawUntilPlayable ? 1 : 1;
      const drawn = drawCards(next, playerId, count, events);
      next.drawnThisTurn += drawn;
      events.push({ type: "draw", playerId, text: "draws a card" });

      const canNowPlay = playableCards(next, playerId).length > 0;
      const stockSpent = next.stock.length === 0 && next.pile.length <= 1;

      // Nothing playable and no way to keep drawing: the turn simply passes.
      if (!canNowPlay && (!next.rules.drawUntilPlayable || stockSpent || drawn === 0)) {
        next.drawnThisTurn = 0;
        advance(next);
      }
      return { state: next, events };
    }

    // ---- pass ----
    if (isType(move, "pass")) {
      next.drawnThisTurn = 0;
      events.push({ type: "pass", playerId, text: "passes" });
      advance(next);
      return { state: next, events };
    }

    // ---- play a card ----
    const played = (move as { cardId: string }).cardId;
    const index = player.hand.findIndex((c) => cardId(c) === played);
    const card = player.hand[index]!;
    player.hand.splice(index, 1);
    next.pile.push(card);
    next.declaredSuit = null;
    next.drawnThisTurn = 0;

    events.push({ type: "play", playerId, text: `plays ${cardLabel(card)}`, data: { card } });

    // Win: first to empty their hand.
    if (player.hand.length === 0) {
      next.finished = true;
      next.winners = [playerId];
      events.push({ type: "gameOver", playerId, text: "sheds their last card and wins!" });
      return { state: next, events };
    }

    const rules = next.rules;
    let skip = 0;

    if (rules.wildRank !== null && card.rank === rules.wildRank) {
      const declared = (move as { declareSuit?: Suit }).declareSuit ?? card.suit;
      next.declaredSuit = declared;
      events.push({ type: "wild", playerId, text: `calls ${declared}`, data: { suit: declared } });
    }

    if (rules.drawTwoRank !== null && card.rank === rules.drawTwoRank) {
      next.pendingDraw += 2;
      events.push({ type: "drawTwo", playerId, text: `draw two (${next.pendingDraw} owed)` });
    }

    if (rules.skipRanks.includes(card.rank)) {
      skip = 1;
      events.push({ type: "skip", playerId, text: "skips the next player" });
    }

    if (rules.reverseRank !== null && card.rank === rules.reverseRank) {
      // Heads-up, a reverse acts as a skip — there is nobody to turn back to.
      if (next.players.length === 2) skip = 1;
      else next.direction = next.direction === 1 ? -1 : 1;
      events.push({ type: "reverse", playerId, text: "reverses play" });
    }

    // Announcing is only valid while actually on one card.
    if (player.hand.length !== 1) player.announced = false;

    advance(next, 1 + skip);
    return { state: next, events };
  },

  /**
   * Hidden hands, via the same helper Whot uses: own hand in full, everyone
   * else reduced to a count.
   */
  getPlayerView(state, playerId): Crazy8sPlayerView {
    const hidden = redactHands<Card, Crazy8sPlayerState>(state.players, {
      viewerId: playerId,
      revealAll: state.finished,
    });
    const me = playerId ? playerOf(state, playerId) : null;
    const isMyTurn = !state.finished && state.players[state.currentIndex]?.id === playerId;

    return {
      rulesId: state.rules.id,
      rulesName: state.rules.name,
      myHand: hidden.myHand,
      opponents: state.players
        .filter((p) => p.id !== playerId)
        .map((p) => ({ id: p.id, cardCount: p.hand.length, announced: p.announced })),
      topCard: topOf(state),
      activeSuit: activeSuit(state),
      stockCount: state.stock.length,
      pileCount: state.pile.length,
      currentPlayerId: state.finished ? null : state.players[state.currentIndex]?.id ?? null,
      direction: state.direction,
      pendingDraw: state.pendingDraw,
      playableCardIds: isMyTurn && me ? playableCards(state, me.id).map(cardId) : [],
      shouldAnnounce: !!me && state.rules.mustAnnounceLastCard && me.hand.length === 1 && !me.announced,
      callableIds: state.rules.mustAnnounceLastCard
        ? state.players.filter((p) => p.id !== playerId && p.hand.length === 1 && !p.announced).map((p) => p.id)
        : [],
      mustAnnounceLastCard: state.rules.mustAnnounceLastCard,
      finished: state.finished,
      winners: state.winners,
      seesAllHands: hidden.seesAllHands,
      allHands: hidden.allHands,
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
   * Forfeiting skips the player. Any pick-up debt stays on the table for
   * them — dodging a draw-two by going quiet should not pay off.
   */
  forfeitTurn(state, playerId): Crazy8sState | null {
    if (state.finished || state.players[state.currentIndex]?.id !== playerId) return null;
    const next: Crazy8sState = structuredClone(state);
    next.drawnThisTurn = 0;
    advance(next);
    return next;
  },

  getTimeoutMove(state, playerId): Crazy8sMove | null {
    if (state.finished || state.players[state.currentIndex]?.id !== playerId) return null;
    const playable = playableCards(state, playerId);
    const card = playable[0];
    if (card) {
      if (state.rules.wildRank !== null && card.rank === state.rules.wildRank) {
        // Name whichever suit this hand holds most of.
        const player = playerOf(state, playerId)!;
        const counts = new Map<Suit, number>();
        for (const c of player.hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
        const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? SUITS[0]!;
        return { type: "play", cardId: cardId(card), declareSuit: best };
      }
      return { type: "play", cardId: cardId(card) };
    }
    if (state.drawnThisTurn > 0) return { type: "pass" };
    return { type: "draw" };
  },

  getEliminatedPlayers(): string[] {
    return []; // Everyone plays until somebody goes out.
  },
};

export { CRAZY8S_VARIANTS };
