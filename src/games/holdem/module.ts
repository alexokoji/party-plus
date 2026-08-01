import { nextRandom } from "../../engine/rng";
import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";
import {
  buildDeck,
  cardLabel,
  compareHands,
  evaluateHand,
  shuffleDeck,
  type Card,
  type HandValue,
} from "./cards";

/**
 * PLAY-MONEY ONLY.
 *
 * Chips here are a score, nothing more. There is no deposit, no cash-out, no
 * exchange rate and no persistence of balances between rooms — every table
 * starts everyone on the same stack and the numbers evaporate when the room
 * does. Nothing of monetary value is ever wagered. Keep it that way: this is
 * a party game, and turning it into anything else would make it a regulated
 * gambling product.
 */
export const PLAY_MONEY_ONLY = true;

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export type HoldemMove =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "bet"; amount: number }
  | { type: "raise"; amount: number }
  | { type: "allIn" };

export interface HoldemPlayerState {
  id: string;
  /** Play-money chips still in front of the player. */
  chips: number;
  hole: Card[];
  /** Chips committed during the current betting round. */
  committed: number;
  /** Chips committed across the whole hand, used for side pots. */
  totalCommitted: number;
  folded: boolean;
  allIn: boolean;
  /** Knocked out of the session — no chips left between hands. */
  busted: boolean;
  hasActedThisRound: boolean;
}

export interface Pot {
  amount: number;
  /** Players eligible to win this pot. */
  eligible: string[];
}

export interface ShowdownEntry {
  playerId: string;
  hole: Card[];
  hand: HandValue | null;
  won: number;
}

export interface HoldemState {
  players: HoldemPlayerState[];
  deck: Card[];
  board: Card[];
  street: Street;
  /** Seat index of the dealer button. */
  buttonIndex: number;
  currentIndex: number;
  smallBlind: number;
  bigBlind: number;
  /** Highest total committed this round; players must match it to stay in. */
  currentBet: number;
  /** Size of the last bet or raise, which sets the minimum next raise. */
  lastRaiseSize: number;
  pot: number;
  rngState: number;
  handNumber: number;
  finished: boolean;
  winners: string[];
  /** Populated at showdown so clients can render the reveal. */
  showdown: ShowdownEntry[] | null;
  /** True between hands, waiting for the next deal. */
  handComplete: boolean;
}

export interface HoldemOpponentView {
  id: string;
  chips: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  busted: boolean;
  /** How many hole cards they hold — never which. */
  cardCount: number;
  /** Only ever populated at showdown. */
  revealed: Card[] | null;
}

export interface HoldemPlayerView {
  /** Only ever this recipient's own hole cards. */
  myHole: Card[];
  /** Best hand this player currently holds, for their own information. */
  myBestHand: HandValue | null;
  me: HoldemOpponentView | null;
  opponents: HoldemOpponentView[];
  board: Card[];
  street: Street;
  pot: number;
  pots: Pot[];
  currentBet: number;
  toCall: number;
  minRaiseTo: number;
  currentPlayerId: string | null;
  buttonId: string | null;
  smallBlind: number;
  bigBlind: number;
  legalMoves: HoldemMove["type"][];
  handNumber: number;
  handComplete: boolean;
  finished: boolean;
  winners: string[];
  showdown: ShowdownEntry[] | null;
  seesAllHands: boolean;
  /** Present so no UI can imply real money is involved. */
  playMoneyOnly: true;
}

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown"];

function activePlayers(state: HoldemState): HoldemPlayerState[] {
  return state.players.filter((p) => !p.folded && !p.busted);
}

/** Players who can still act (not folded, not all-in). */
function actablePlayers(state: HoldemState): HoldemPlayerState[] {
  return activePlayers(state).filter((p) => !p.allIn);
}

function playerOf(state: HoldemState, id: string): HoldemPlayerState | null {
  return state.players.find((p) => p.id === id) ?? null;
}

function toCallFor(state: HoldemState, player: HoldemPlayerState): number {
  return Math.max(0, Math.min(state.currentBet - player.committed, player.chips));
}

/**
 * Splits the pot into a main pot and side pots.
 *
 * Each distinct all-in level creates a layer that only the players who
 * reached it can win. Without this, a short stack who is all-in for less
 * could scoop chips they never matched.
 */
export function buildPots(state: HoldemState): Pot[] {
  const contributors = state.players.filter((p) => p.totalCommitted > 0);
  if (contributors.length === 0) return [];

  const levels = [...new Set(contributors.map((p) => p.totalCommitted))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;

  for (const level of levels) {
    const slice = level - previous;
    const payers = contributors.filter((p) => p.totalCommitted >= level);
    const amount = slice * payers.length;
    if (amount > 0) {
      pots.push({
        amount,
        // Folded players pay in but cannot win.
        eligible: payers.filter((p) => !p.folded).map((p) => p.id),
      });
    }
    previous = level;
  }

  // Merge adjacent pots with identical eligibility, purely for tidier display.
  const merged: Pot[] = [];
  for (const pot of pots) {
    const last = merged[merged.length - 1];
    if (last && last.eligible.join(",") === pot.eligible.join(",")) last.amount += pot.amount;
    else merged.push({ ...pot });
  }
  return merged;
}

function legalMovesFor(state: HoldemState, player: HoldemPlayerState): HoldemMove["type"][] {
  if (state.handComplete || state.finished) return [];
  if (player.folded || player.allIn || player.busted) return [];
  if (state.players[state.currentIndex]?.id !== player.id) return [];

  const moves: HoldemMove["type"][] = ["fold"];
  const owed = toCallFor(state, player);

  if (owed === 0) moves.push("check");
  else if (player.chips > 0) moves.push("call");

  const minRaiseTo = state.currentBet + Math.max(state.lastRaiseSize, state.bigBlind);
  const canCoverRaise = player.chips + player.committed > state.currentBet;
  if (canCoverRaise) {
    if (state.currentBet === 0) moves.push("bet");
    else moves.push("raise");
    void minRaiseTo;
  }
  if (player.chips > 0) moves.push("allIn");

  return moves;
}

function minRaiseTarget(state: HoldemState): number {
  return state.currentBet + Math.max(state.lastRaiseSize, state.bigBlind);
}

/** Moves the action to the next player who can still act. */
function advanceAction(state: HoldemState): void {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (state.currentIndex + step) % n;
    const p = state.players[idx]!;
    if (!p.folded && !p.busted && !p.allIn) {
      state.currentIndex = idx;
      return;
    }
  }
}

/** True when everyone still in has matched the bet and had a chance to act. */
function bettingRoundComplete(state: HoldemState): boolean {
  const canAct = actablePlayers(state);
  if (canAct.length === 0) return true;
  if (activePlayers(state).length <= 1) return true;
  return canAct.every((p) => p.hasActedThisRound && p.committed === state.currentBet);
}

function firstToActPostflop(state: HoldemState): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (state.buttonIndex + step) % n;
    const p = state.players[idx]!;
    if (!p.folded && !p.busted && !p.allIn) return idx;
  }
  return state.currentIndex;
}

function dealBoard(state: HoldemState, count: number): Card[] {
  const dealt: Card[] = [];
  for (let i = 0; i < count; i++) {
    const card = state.deck.pop();
    if (card) dealt.push(card);
  }
  state.board.push(...dealt);
  return dealt;
}

function startBettingRound(state: HoldemState): void {
  state.currentBet = 0;
  state.lastRaiseSize = 0;
  for (const p of state.players) {
    p.committed = 0;
    p.hasActedThisRound = false;
  }
  state.currentIndex = firstToActPostflop(state);
}

/** Advances to the next street, dealing as needed. */
function advanceStreet(state: HoldemState, events: GameEvent[]): void {
  const index = STREET_ORDER.indexOf(state.street);
  const next = STREET_ORDER[index + 1] ?? "showdown";
  state.street = next;

  if (next === "flop") {
    const cards = dealBoard(state, 3);
    events.push({ type: "flop", text: `flop: ${cards.map(cardLabel).join(" ")}`, data: { cards } });
  } else if (next === "turn") {
    const [card] = dealBoard(state, 1);
    events.push({ type: "turn", text: `turn: ${card ? cardLabel(card) : "?"}`, data: { card } });
  } else if (next === "river") {
    const [card] = dealBoard(state, 1);
    events.push({ type: "river", text: `river: ${card ? cardLabel(card) : "?"}`, data: { card } });
  }

  if (next === "showdown") {
    resolveShowdown(state, events);
    return;
  }
  startBettingRound(state);
}

/** Deals out any remaining board cards when everyone is all-in. */
function runOutBoard(state: HoldemState, events: GameEvent[]): void {
  while (state.board.length < 5) {
    const needed = state.board.length === 0 ? 3 : 1;
    const cards = dealBoard(state, needed);
    events.push({ type: "runout", text: `runs out ${cards.map(cardLabel).join(" ")}`, data: { cards } });
  }
  state.street = "showdown";
  resolveShowdown(state, events);
}

/** Awards each pot to its best eligible hand, splitting genuine ties. */
function resolveShowdown(state: HoldemState, events: GameEvent[]): void {
  const pots = buildPots(state);
  const contenders = activePlayers(state);

  const evaluated = new Map<string, HandValue>();
  for (const p of contenders) {
    evaluated.set(p.id, evaluateHand([...p.hole, ...state.board]));
  }

  const winnings = new Map<string, number>();

  for (const pot of pots) {
    const eligible = pot.eligible.filter((id) => evaluated.has(id));
    if (eligible.length === 0) continue;

    let best: string[] = [];
    for (const id of eligible) {
      if (best.length === 0) {
        best = [id];
        continue;
      }
      const cmp = compareHands(evaluated.get(id)!, evaluated.get(best[0]!)!);
      if (cmp > 0) best = [id];
      else if (cmp === 0) best.push(id);
    }

    const share = Math.floor(pot.amount / best.length);
    let remainder = pot.amount - share * best.length;
    for (const id of best) {
      // Odd chips go to the earliest seat, a common house convention; the
      // alternative (discarding them) would leak chips out of the game.
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      winnings.set(id, (winnings.get(id) ?? 0) + share + extra);
    }
  }

  for (const [id, amount] of winnings) {
    const player = playerOf(state, id);
    if (player) player.chips += amount;
  }

  state.showdown = contenders.map((p) => ({
    playerId: p.id,
    hole: [...p.hole],
    hand: evaluated.get(p.id) ?? null,
    won: winnings.get(p.id) ?? 0,
  }));

  for (const entry of state.showdown) {
    if (entry.won > 0) {
      events.push({
        type: "wins",
        playerId: entry.playerId,
        text: `wins ${entry.won} chips with ${entry.hand?.label ?? "the last hand standing"}`,
        data: { amount: entry.won, hand: entry.hand?.label },
      });
    }
  }

  completeHand(state, events);
}

/** Everyone folded to one player: award without revealing anything. */
function awardUncontested(state: HoldemState, events: GameEvent[]): void {
  const winner = activePlayers(state)[0];
  if (!winner) return;
  const total = state.players.reduce((sum, p) => sum + p.totalCommitted, 0);
  winner.chips += total;
  state.showdown = [
    { playerId: winner.id, hole: [], hand: null, won: total },
  ];
  events.push({
    type: "wins",
    playerId: winner.id,
    text: `takes ${total} chips — everyone folded`,
    data: { amount: total },
  });
  completeHand(state, events);
}

function completeHand(state: HoldemState, events: GameEvent[]): void {
  state.pot = 0;
  state.handComplete = true;

  for (const p of state.players) {
    if (p.chips <= 0) {
      p.busted = true;
      p.chips = 0;
    }
  }

  const survivors = state.players.filter((p) => !p.busted);
  if (survivors.length <= 1) {
    state.finished = true;
    state.winners = survivors.map((p) => p.id);
    events.push({
      type: "gameOver",
      playerId: state.winners[0],
      text: "takes the table",
    });
  }
}

/** Deals the next hand: blinds posted, hole cards out. */
function beginHand(state: HoldemState, events: GameEvent[]): void {
  const seated = state.players.filter((p) => !p.busted);
  if (seated.length <= 1) {
    state.finished = true;
    state.winners = seated.map((p) => p.id);
    return;
  }

  state.handNumber += 1;
  state.board = [];
  state.street = "preflop";
  state.showdown = null;
  state.handComplete = false;
  state.pot = 0;
  state.currentBet = 0;
  state.lastRaiseSize = 0;

  const shuffled = shuffleDeck(buildDeck(), state.rngState);
  state.deck = shuffled.deck;
  state.rngState = shuffled.rngState;

  for (const p of state.players) {
    p.hole = [];
    p.committed = 0;
    p.totalCommitted = 0;
    p.folded = p.busted;
    p.allIn = false;
    p.hasActedThisRound = false;
  }

  // Move the button to the next non-busted seat.
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (state.buttonIndex + step) % n;
    if (!state.players[idx]!.busted) {
      state.buttonIndex = idx;
      break;
    }
  }

  for (let i = 0; i < 2; i++) {
    for (const p of state.players) {
      if (p.busted) continue;
      const card = state.deck.pop();
      if (card) p.hole.push(card);
    }
  }

  const order = seatOrderFrom(state, state.buttonIndex);
  // Heads-up: the button posts the small blind and acts first pre-flop.
  const [sbSeat, bbSeat] = order.length === 2 ? [order[0]!, order[1]!] : [order[1]!, order[2]!];

  postBlind(state, sbSeat, state.smallBlind, events, "small blind");
  postBlind(state, bbSeat, state.bigBlind, events, "big blind");

  state.currentBet = state.bigBlind;
  state.lastRaiseSize = state.bigBlind;

  // Action starts left of the big blind (or on the button heads-up).
  const bbIndex = state.players.findIndex((p) => p.id === bbSeat.id);
  state.currentIndex = bbIndex;
  advanceAction(state);

  events.push({ type: "deal", text: `hand ${state.handNumber} dealt`, data: { handNumber: state.handNumber } });
}

function seatOrderFrom(state: HoldemState, from: number): HoldemPlayerState[] {
  const out: HoldemPlayerState[] = [];
  const n = state.players.length;
  for (let step = 0; step < n; step++) {
    const p = state.players[(from + step) % n]!;
    if (!p.busted) out.push(p);
  }
  return out;
}

function postBlind(
  state: HoldemState,
  player: HoldemPlayerState,
  amount: number,
  events: GameEvent[],
  label: string
): void {
  const posted = Math.min(amount, player.chips);
  player.chips -= posted;
  player.committed += posted;
  player.totalCommitted += posted;
  state.pot += posted;
  if (player.chips === 0) player.allIn = true;
  events.push({ type: "blind", playerId: player.id, text: `posts the ${label} (${posted})`, data: { amount: posted } });
}

function commit(state: HoldemState, player: HoldemPlayerState, amount: number): number {
  const paid = Math.min(amount, player.chips);
  player.chips -= paid;
  player.committed += paid;
  player.totalCommitted += paid;
  state.pot += paid;
  if (player.chips === 0) player.allIn = true;
  return paid;
}

function isMoveShape(move: unknown): move is HoldemMove {
  if (typeof move !== "object" || move === null) return false;
  const t = (move as { type?: unknown }).type;
  if (t === "fold" || t === "check" || t === "call" || t === "allIn") return true;
  if (t === "bet" || t === "raise") {
    const amount = (move as { amount?: unknown }).amount;
    return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
  }
  return false;
}

export const holdemModule: GameModule<HoldemState, HoldemMove, HoldemPlayerView> = {
  meta: {
    id: "holdem",
    name: "Texas Hold'em",
    tagline: "Play-money poker. Chips are just points — nothing to cash out.",
    minPlayers: 2,
    maxPlayers: 9,
    category: "card",
    modes: ["room"],
    hasHiddenState: true,
    estimatedMinutes: 25,
  },

  createInitialState(players: string[], options: GameOptions = {}): HoldemState {
    const startingChips = typeof options.startingChips === "number" ? options.startingChips : 1000;
    const bigBlind = typeof options.bigBlind === "number" ? options.bigBlind : 20;
    const seed = typeof options.seed === "number" ? options.seed : Math.floor(Math.random() * 2 ** 31);

    const state: HoldemState = {
      players: players.map((id) => ({
        id,
        chips: startingChips,
        hole: [],
        committed: 0,
        totalCommitted: 0,
        folded: false,
        allIn: false,
        busted: false,
        hasActedThisRound: false,
      })),
      deck: [],
      board: [],
      street: "preflop",
      buttonIndex: players.length - 1,
      currentIndex: 0,
      smallBlind: Math.max(1, Math.floor(bigBlind / 2)),
      bigBlind,
      currentBet: 0,
      lastRaiseSize: 0,
      pot: 0,
      rngState: seed >>> 0,
      handNumber: 0,
      finished: false,
      winners: [],
      showdown: null,
      handComplete: false,
    };

    beginHand(state, []);
    return state;
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished) return false;
    if (!isMoveShape(move)) return false;

    const player = playerOf(state, playerId);
    if (!player) return false;

    // Between hands the only "move" is dealing the next one, which any
    // remaining player may trigger.
    if (state.handComplete) return move.type === "check" && !player.busted;

    if (state.players[state.currentIndex]?.id !== playerId) return false;
    const legal = legalMovesFor(state, player);
    if (!legal.includes(move.type)) return false;

    if (move.type === "bet") {
      const min = Math.max(state.bigBlind, state.lastRaiseSize);
      // An all-in for less than a full bet is allowed via allIn, not bet.
      return move.amount >= min && move.amount <= player.chips;
    }
    if (move.type === "raise") {
      const target = minRaiseTarget(state);
      const maxTo = player.chips + player.committed;
      return move.amount >= target && move.amount <= maxTo;
    }
    return true;
  },

  applyMove(state, playerId, move): ApplyResult<HoldemState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const next: HoldemState = structuredClone(state);
    const events: GameEvent[] = [];

    // Deal the next hand.
    if (next.handComplete) {
      beginHand(next, events);
      return { state: next, events };
    }

    const player = playerOf(next, playerId)!;
    player.hasActedThisRound = true;

    switch (move.type) {
      case "fold":
        player.folded = true;
        events.push({ type: "fold", playerId, text: "folds" });
        break;

      case "check":
        events.push({ type: "check", playerId, text: "checks" });
        break;

      case "call": {
        const paid = commit(next, player, toCallFor(next, player));
        events.push({ type: "call", playerId, text: `calls ${paid}`, data: { amount: paid } });
        break;
      }

      case "bet": {
        const paid = commit(next, player, move.amount);
        next.currentBet = player.committed;
        next.lastRaiseSize = paid;
        // A bet reopens the action for everyone else.
        for (const other of next.players) if (other.id !== playerId) other.hasActedThisRound = false;
        events.push({ type: "bet", playerId, text: `bets ${paid}`, data: { amount: paid } });
        break;
      }

      case "raise": {
        const target = move.amount;
        const increment = target - next.currentBet;
        commit(next, player, target - player.committed);
        next.lastRaiseSize = increment;
        next.currentBet = player.committed;
        for (const other of next.players) if (other.id !== playerId) other.hasActedThisRound = false;
        events.push({ type: "raise", playerId, text: `raises to ${next.currentBet}`, data: { to: next.currentBet } });
        break;
      }

      case "allIn": {
        const paid = commit(next, player, player.chips);
        if (player.committed > next.currentBet) {
          const increment = player.committed - next.currentBet;
          // Only a full raise reopens betting; a short all-in does not.
          if (increment >= next.lastRaiseSize) {
            next.lastRaiseSize = increment;
            for (const other of next.players) if (other.id !== playerId) other.hasActedThisRound = false;
          }
          next.currentBet = player.committed;
        }
        events.push({ type: "allIn", playerId, text: `is all in for ${paid}`, data: { amount: paid } });
        break;
      }
    }

    // Everyone but one folded?
    if (activePlayers(next).length <= 1) {
      awardUncontested(next, events);
      return { state: next, events };
    }

    if (bettingRoundComplete(next)) {
      // Nobody left who can act: run the board out and show down.
      if (actablePlayers(next).length <= 1 && next.street !== "river") {
        const stillBetting = actablePlayers(next);
        const someoneCanStillBet = stillBetting.length === 1 && toCallFor(next, stillBetting[0]!) > 0;
        if (!someoneCanStillBet) {
          runOutBoard(next, events);
          return { state: next, events };
        }
      }
      advanceStreet(next, events);
      return { state: next, events };
    }

    advanceAction(next);
    return { state: next, events };
  },

  /**
   * The redaction chokepoint.
   *
   * Hole cards are the whole game: a player sees their own two cards and, for
   * everyone else, only a count — until a showdown makes them public. Built by
   * listing permitted fields rather than deleting secrets from a copy, so a
   * new field on HoldemState cannot leak by default.
   */
  getPlayerView(state, playerId): HoldemPlayerView {
    const me = playerId ? playerOf(state, playerId) : null;
    const showdownOver = state.showdown !== null;
    const seesAllHands = playerId === null || showdownOver;

    const revealedFor = (p: HoldemPlayerState): Card[] | null => {
      if (!showdownOver) return null;
      const entry = state.showdown?.find((s) => s.playerId === p.id);
      return entry && entry.hole.length > 0 ? entry.hole : null;
    };

    const summarise = (p: HoldemPlayerState): HoldemOpponentView => ({
      id: p.id,
      chips: p.chips,
      committed: p.committed,
      folded: p.folded,
      allIn: p.allIn,
      busted: p.busted,
      cardCount: p.hole.length,
      revealed: revealedFor(p),
    });

    const current = state.players[state.currentIndex];

    return {
      myHole: me ? [...me.hole] : [],
      myBestHand:
        me && me.hole.length > 0 && state.board.length >= 3
          ? evaluateHand([...me.hole, ...state.board])
          : null,
      me: me ? summarise(me) : null,
      opponents: state.players.filter((p) => p.id !== playerId).map(summarise),
      board: [...state.board],
      street: state.street,
      pot: state.pot,
      pots: buildPots(state),
      currentBet: state.currentBet,
      toCall: me ? toCallFor(state, me) : 0,
      minRaiseTo: minRaiseTarget(state),
      currentPlayerId: state.finished || state.handComplete ? null : current?.id ?? null,
      buttonId: state.players[state.buttonIndex]?.id ?? null,
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      legalMoves: me ? legalMovesFor(state, me) : [],
      handNumber: state.handNumber,
      handComplete: state.handComplete,
      finished: state.finished,
      winners: state.winners,
      showdown: state.showdown,
      seesAllHands,
      playMoneyOnly: true,
    };
  },

  checkWinCondition(state): WinCondition | null {
    if (!state.finished) return null;
    return { finished: true, winners: state.winners };
  },

  getCurrentPlayerId(state): string | null {
    if (state.finished) return null;
    if (state.handComplete) {
      // Anyone still in can deal the next hand; nominate the button.
      return state.players.find((p) => !p.busted)?.id ?? null;
    }
    return state.players[state.currentIndex]?.id ?? null;
  },

  getTimeoutMove(state, playerId): HoldemMove | null {
    if (state.finished) return null;
    if (state.handComplete) return { type: "check" };
    const player = playerOf(state, playerId);
    if (!player) return null;
    const legal = legalMovesFor(state, player);
    if (legal.length === 0) return null;
    // Never bet someone's chips for them: check if free, else fold.
    if (legal.includes("check")) return { type: "check" };
    return { type: "fold" };
  },

  getEliminatedPlayers(state): string[] {
    return state.players.filter((p) => p.busted).map((p) => p.id);
  },
};

export { legalMovesFor, toCallFor, minRaiseTarget, activePlayers };
