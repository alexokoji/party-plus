import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";
import { redactHands } from "../shared/hiddenHand";
import { buildDeck, canPlay, describeCard, handTotal, shuffle, type WhotCard } from "./deck";
import {
  CLASSIC_NIGERIAN,
  getVariant,
  SHAPES,
  WHOT_VARIANTS,
  type Shape,
  type WhotRules,
} from "./rules";

export type WhotMove =
  | { type: "play"; cardId: string; requestShape?: Shape }
  | { type: "draw" };

export interface WhotPlayerState {
  id: string;
  hand: WhotCard[];
}

export interface WhotState {
  rules: WhotRules;
  players: WhotPlayerState[];
  market: WhotCard[];
  /** Discard pile; the last element is the face-up top card. */
  pile: WhotCard[];
  currentIndex: number;
  /** Shape demanded by a Whot wildcard, until it is satisfied. */
  requestedShape: Shape | null;
  /** Accumulated Pick Two / Pick Three debt owed by the player to act. */
  pendingDraw: number;
  /** Which special started the current chain, so stacking can be restricted. */
  pendingKind: "pickTwo" | "pickThree" | null;
  finished: boolean;
  winners: string[];
  /** Reason the match ended, for the result banner. */
  endReason: "emptyHand" | "marketExhausted" | null;
  seed: number;
  /** Bumped every reshuffle so repeated shuffles do not repeat an order. */
  shuffleCount: number;
}

export interface WhotOpponentView {
  id: string;
  cardCount: number;
}

export interface WhotPlayerView {
  rulesId: string;
  rulesName: string;
  /** Only ever this recipient's own hand. */
  myHand: WhotCard[];
  /** Card counts only — never the cards themselves. */
  opponents: WhotOpponentView[];
  topCard: WhotCard | null;
  requestedShape: Shape | null;
  marketCount: number;
  pileCount: number;
  currentPlayerId: string | null;
  pendingDraw: number;
  pendingKind: "pickTwo" | "pickThree" | null;
  finished: boolean;
  winners: string[];
  endReason: WhotState["endReason"];
  /** Card ids in `myHand` that are legal right now. Empty when not your turn. */
  playableCardIds: string[];
  /** True when this recipient may see every hand (spectator or finished). */
  seesAllHands: boolean;
  /** Populated only when seesAllHands — otherwise empty. */
  allHands: Record<string, WhotCard[]>;
  handTotals: Record<string, number> | null;
}

function isShape(value: unknown): value is Shape {
  return typeof value === "string" && (SHAPES as string[]).includes(value);
}

function isPlayMove(move: unknown): move is { type: "play"; cardId: string; requestShape?: Shape } {
  if (typeof move !== "object" || move === null) return false;
  const m = move as { type?: unknown; cardId?: unknown; requestShape?: unknown };
  if (m.type !== "play" || typeof m.cardId !== "string") return false;
  return m.requestShape === undefined || isShape(m.requestShape);
}

function isDrawMove(move: unknown): move is { type: "draw" } {
  return typeof move === "object" && move !== null && (move as { type?: unknown }).type === "draw";
}

const topOf = (state: WhotState): WhotCard | null => state.pile[state.pile.length - 1] ?? null;

const playerOf = (state: WhotState, id: string) => state.players.find((p) => p.id === id) ?? null;

/** Special-card identity, resolved through the variant's config. */
function specialOf(card: WhotCard, rules: WhotRules): keyof WhotRules["specials"] | null {
  if (card.shape === "whot") return rules.specials.wild === card.number ? "wild" : null;
  const s = rules.specials;
  if (s.holdOn === card.number) return "holdOn";
  if (s.pickTwo === card.number) return "pickTwo";
  if (s.pickThree === card.number) return "pickThree";
  if (s.suspension === card.number) return "suspension";
  if (s.generalMarket === card.number) return "generalMarket";
  return null;
}

/** Cards a player may legally put down right now. */
function playableCards(state: WhotState, playerId: string): WhotCard[] {
  const player = playerOf(state, playerId);
  const top = topOf(state);
  if (!player || !top) return [];

  // Under a Pick debt you may only answer with a matching Pick card, if the
  // variant permits stacking at all.
  if (state.pendingDraw > 0) {
    const rules = state.rules;
    const allowed: number[] = [];
    if (state.pendingKind === "pickTwo" && rules.stackPickTwo && rules.specials.pickTwo !== null) {
      allowed.push(rules.specials.pickTwo);
    }
    if (state.pendingKind === "pickThree" && rules.stackPickThree && rules.specials.pickThree !== null) {
      allowed.push(rules.specials.pickThree);
    }
    if (rules.crossStacking) {
      if (rules.stackPickTwo && rules.specials.pickTwo !== null) allowed.push(rules.specials.pickTwo);
      if (rules.stackPickThree && rules.specials.pickThree !== null) allowed.push(rules.specials.pickThree);
    }
    return player.hand.filter((c) => c.shape !== "whot" && allowed.includes(c.number));
  }

  return player.hand.filter((c) => canPlay(c, top, state.requestedShape, state.rules));
}

/** Draws `count` cards, refilling from the pile if the variant reshuffles. */
function drawCards(state: WhotState, playerId: string, count: number, events: GameEvent[]): void {
  const player = playerOf(state, playerId);
  if (!player) return;
  for (let i = 0; i < count; i++) {
    if (state.market.length === 0) {
      if (!refillMarket(state, events)) return; // exhausted; caller decides the outcome
    }
    const card = state.market.pop();
    if (!card) return;
    player.hand.push(card);
  }
}

/**
 * Refills an empty market from the discard pile, keeping the top card in play.
 * Returns false when there is nothing left to recycle.
 */
function refillMarket(state: WhotState, events: GameEvent[]): boolean {
  if (state.rules.onMarketExhausted !== "reshuffle") return false;
  if (state.pile.length <= 1) return false;
  const top = state.pile.pop()!;
  state.market = shuffle(state.pile, state.seed + 1000 + state.shuffleCount++);
  state.pile = [top];
  events.push({ type: "reshuffle", text: "market ran dry — play pile reshuffled" });
  return true;
}

/** Ends the match on hand totals when the market is spent. */
function endOnTotals(state: WhotState, events: GameEvent[]): void {
  const totals = state.players.map((p) => ({ id: p.id, total: handTotal(p.hand, state.rules) }));
  const lowest = Math.min(...totals.map((t) => t.total));
  const highest = Math.max(...totals.map((t) => t.total));

  state.finished = true;
  state.endReason = "marketExhausted";
  state.winners =
    state.rules.onMarketExhausted === "lowestTotalLoses"
      ? totals.filter((t) => t.total !== lowest || lowest === highest).map((t) => t.id)
      : totals.filter((t) => t.total === lowest).map((t) => t.id);

  events.push({
    type: "marketExhausted",
    text: `market exhausted — ${state.rules.onMarketExhausted === "lowestTotalLoses" ? "lowest hand loses" : "lowest hand wins"}`,
    data: { totals: Object.fromEntries(totals.map((t) => [t.id, t.total])) },
  });
}

function advance(state: WhotState, steps = 1): void {
  const n = state.players.length;
  state.currentIndex = (state.currentIndex + steps) % n;
}

export const whotModule: GameModule<WhotState, WhotMove, WhotPlayerView> = {
  meta: {
    id: "whot",
    name: "Whot!",
    tagline: "Shapes, numbers, and the sweet cruelty of Pick Three.",
    minPlayers: 2,
    maxPlayers: 6,
    category: "card",
    modes: ["room"],
    hasHiddenState: true,
    estimatedMinutes: 12,
    // Whot rules genuinely differ by region, so a room picks one rather than
    // the module baking a single interpretation in.
    variants: WHOT_VARIANTS.map((v) => ({ id: v.id, name: v.name, description: v.description })),
    variantOptionKey: "variant",
  },

  createInitialState(players: string[], options: GameOptions = {}): WhotState {
    const rules = getVariant(options.variant as string | undefined) ?? CLASSIC_NIGERIAN;
    const seed = typeof options.seed === "number" ? options.seed : Math.floor(Math.random() * 2 ** 31);
    const deck = shuffle(buildDeck(rules), seed);

    const hands: WhotPlayerState[] = players.map((id) => ({ id, hand: [] }));
    for (let i = 0; i < rules.handSize; i++) {
      for (const player of hands) {
        const card = deck.pop();
        if (card) player.hand.push(card);
      }
    }

    // The opening card must not be a wildcard: nobody has named a shape yet.
    let opening = deck.pop()!;
    const buffer: WhotCard[] = [];
    while (opening && opening.shape === "whot" && deck.length) {
      buffer.push(opening);
      opening = deck.pop()!;
    }

    return {
      rules,
      players: hands,
      market: [...buffer, ...deck],
      pile: [opening],
      currentIndex: 0,
      requestedShape: null,
      pendingDraw: 0,
      pendingKind: null,
      finished: false,
      winners: [],
      endReason: null,
      seed,
      shuffleCount: 0,
    };
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished) return false;
    if (state.players[state.currentIndex]?.id !== playerId) return false;
    const player = playerOf(state, playerId);
    if (!player) return false;

    if (isDrawMove(move)) {
      // Under a debt, drawing is always available — it is how you pay.
      if (state.pendingDraw > 0) return true;
      if (state.rules.mustPlayIfAble && playableCards(state, playerId).length > 0) return false;
      return true;
    }

    if (!isPlayMove(move)) return false;
    const card = player.hand.find((c) => c.id === move.cardId);
    if (!card) return false;
    if (!playableCards(state, playerId).some((c) => c.id === card.id)) return false;

    // A wildcard must name a shape, and only a real shape.
    if (specialOf(card, state.rules) === "wild") {
      return move.requestShape === undefined || isShape(move.requestShape);
    }
    return true;
  },

  applyMove(state, playerId, move): ApplyResult<WhotState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const next: WhotState = structuredClone(state);
    const events: GameEvent[] = [];
    const player = playerOf(next, playerId)!;

    // ---- draw / pay a debt ----
    if (isDrawMove(move)) {
      const owed = next.pendingDraw > 0 ? next.pendingDraw : 1;
      const marketBefore = next.market.length;
      drawCards(next, playerId, owed, events);

      if (next.pendingDraw > 0) {
        events.push({ type: "pick", playerId, text: `picked ${owed}`, data: { count: owed } });
        next.pendingDraw = 0;
        next.pendingKind = null;
      } else {
        events.push({ type: "draw", playerId, text: "went to market" });
      }

      // Market spent and the variant does not recycle: settle on totals.
      if (next.market.length === 0 && marketBefore === 0 && next.rules.onMarketExhausted !== "reshuffle") {
        endOnTotals(next, events);
        return { state: next, events };
      }
      if (next.market.length === 0 && next.pile.length <= 1 && next.rules.onMarketExhausted === "reshuffle") {
        // Nothing left anywhere — fall back to totals rather than deadlock.
        endOnTotals(next, events);
        return { state: next, events };
      }

      advance(next);
      return { state: next, events };
    }

    // ---- play a card ----
    const cardIndex = player.hand.findIndex((c) => c.id === (move as { cardId: string }).cardId);
    const card = player.hand[cardIndex]!;
    player.hand.splice(cardIndex, 1);
    next.pile.push(card);
    next.requestedShape = null;

    events.push({
      type: "play",
      playerId,
      text: `played ${describeCard(card)}`,
      data: { card },
    });

    // First to empty their hand wins outright.
    if (player.hand.length === 0) {
      next.finished = true;
      next.winners = [playerId];
      next.endReason = "emptyHand";
      events.push({ type: "gameOver", playerId, text: "went out and wins!" });
      return { state: next, events };
    }

    const special = specialOf(card, next.rules);
    switch (special) {
      case "holdOn":
        events.push({ type: "holdOn", playerId, text: "hold on — plays again" });
        return { state: next, events }; // same player acts again

      case "pickTwo":
        next.pendingDraw += 2;
        next.pendingKind = "pickTwo";
        events.push({ type: "pickTwo", playerId, text: `pick two (${next.pendingDraw} owed)` });
        advance(next);
        return { state: next, events };

      case "pickThree":
        next.pendingDraw += 3;
        next.pendingKind = "pickThree";
        events.push({ type: "pickThree", playerId, text: `pick three (${next.pendingDraw} owed)` });
        advance(next);
        return { state: next, events };

      case "suspension": {
        const skips = card.shape === "star" && next.rules.starSuspensionSkipsTwo ? 2 : 1;
        events.push({
          type: "suspension",
          playerId,
          text: skips === 2 ? "suspension — skips two players" : "suspension — next player misses a turn",
        });
        advance(next, 1 + skips);
        return { state: next, events };
      }

      case "generalMarket": {
        for (const other of next.players) {
          if (other.id === playerId) continue;
          drawCards(next, other.id, 1, events);
        }
        events.push({ type: "generalMarket", playerId, text: "general market — everyone else picks one" });
        if (next.market.length === 0 && next.pile.length <= 1) {
          endOnTotals(next, events);
          return { state: next, events };
        }
        advance(next);
        return { state: next, events };
      }

      case "wild": {
        const requested = (move as { requestShape?: Shape }).requestShape ?? SHAPES[0]!;
        next.requestedShape = requested;
        events.push({
          type: "wild",
          playerId,
          text: `Whot! — asks for ${requested}`,
          data: { requestShape: requested },
        });
        advance(next);
        return { state: next, events };
      }

      default:
        advance(next);
        return { state: next, events };
    }
  },

  /**
   * The redaction chokepoint.
   *
   * A player receives their own hand in full and nothing but *counts* for
   * everyone else. Built by listing allowed fields rather than deleting
   * secrets from a copy, so adding a field to WhotState cannot silently leak
   * it. Spectators and finished matches are the only cases where hands open up.
   */
  getPlayerView(state, playerId): WhotPlayerView {
    const me = playerId ? playerOf(state, playerId) : null;
    // Shared with Crazy 8s: one implementation of "own hand + others' counts".
    const hidden = redactHands<WhotCard, WhotPlayerState>(state.players, {
      viewerId: playerId,
      revealAll: state.finished,
    });
    const seesAllHands = hidden.seesAllHands;

    return {
      rulesId: state.rules.id,
      rulesName: state.rules.name,
      myHand: hidden.myHand,
      opponents: hidden.opponents,
      topCard: topOf(state),
      requestedShape: state.requestedShape,
      marketCount: state.market.length,
      pileCount: state.pile.length,
      currentPlayerId: state.finished ? null : state.players[state.currentIndex]?.id ?? null,
      pendingDraw: state.pendingDraw,
      pendingKind: state.pendingKind,
      finished: state.finished,
      winners: state.winners,
      endReason: state.endReason,
      playableCardIds:
        me && !state.finished && state.players[state.currentIndex]?.id === playerId
          ? playableCards(state, me.id).map((c) => c.id)
          : [],
      seesAllHands,
      allHands: hidden.allHands,
      handTotals: state.finished
        ? Object.fromEntries(state.players.map((p) => [p.id, handTotal(p.hand, state.rules)]))
        : null,
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
   * Stand-in move for an absent player: play a legal card if one is obvious,
   * otherwise go to market. Uses only that seat's own hand.
   */
  /** Forfeiting skips the player; any pending pick stays owed. */
  forfeitTurn(state, playerId): WhotState | null {
    if (state.finished || state.players[state.currentIndex]?.id !== playerId) return null;
    const next: WhotState = structuredClone(state);
    advance(next);
    return next;
  },

  getTimeoutMove(state, playerId): WhotMove | null {
    if (state.finished || state.players[state.currentIndex]?.id !== playerId) return null;
    const playable = playableCards(state, playerId);
    const card = playable[0];
    if (!card) return { type: "draw" };
    if (specialOf(card, state.rules) === "wild") {
      // Ask for whatever the hand holds most of.
      const counts = new Map<Shape, number>();
      for (const c of playerOf(state, playerId)!.hand) {
        if (c.shape !== "whot") counts.set(c.shape, (counts.get(c.shape) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? SHAPES[0]!;
      return { type: "play", cardId: card.id, requestShape: best };
    }
    return { type: "play", cardId: card.id };
  },

  getEliminatedPlayers(): string[] {
    return []; // Whot has no mid-match elimination — everyone plays to the end.
  },
};

export { WHOT_VARIANTS, playableCards };
