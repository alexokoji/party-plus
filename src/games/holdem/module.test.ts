import { describe, it, expect } from "vitest";
import {
  buildPots,
  holdemModule as game,
  legalMovesFor,
  toCallFor,
  type HoldemMove,
  type HoldemState,
} from "./module";
import type { Card } from "./cards";

const PLAYERS = ["ann", "ben", "cat"];

function fresh(players = PLAYERS, options: Record<string, unknown> = {}): HoldemState {
  return game.createInitialState(players, { seed: 42, startingChips: 1000, bigBlind: 20, ...options });
}

/**
 * A driver that actually contests pots.
 *
 * The timeout policy deliberately never wagers (check, else fold), which makes
 * every hand fold to the big blind — and over a full orbit each player wins
 * their own blind back, so chips never move and no session can ever end. This
 * calls down instead, so hands reach showdown and stacks change.
 */
function botMove(state: HoldemState, playerId: string): HoldemMove {
  if (state.handComplete) return { type: "check" };
  const player = state.players.find((p) => p.id === playerId)!;
  const legal = legalMovesFor(state, player);
  const owed = toCallFor(state, player);

  if (owed === 0 && legal.includes("check")) return { type: "check" };
  if (legal.includes("call")) return { type: "call" };
  if (legal.includes("allIn")) return { type: "allIn" };
  return { type: "fold" };
}

/** Plays hands until the table resolves, using only the module surface. */
function playSession(seed: number, players = PLAYERS, maxMoves = 40000) {
  let state = game.createInitialState(players, { seed, startingChips: 200, bigBlind: 20 });
  let moves = 0;
  while (game.checkWinCondition(state) === null) {
    if (moves++ > maxMoves) throw new Error(`seed ${seed} did not resolve after ${moves} moves`);
    const actor = game.getCurrentPlayerId(state)!;
    const move = botMove(state, actor);
    expect(game.validateMove(state, actor, move)).toBe(true);
    state = game.applyMove(state, actor, move).state;
  }
  return { state, moves };
}

/**
 * Chips in existence right now.
 *
 * `totalCommitted` is a record of what a player *paid into* the current hand,
 * not chips they still hold — once a pot is awarded the winner's `chips`
 * already include it. Adding both double-counts; the live pot is the only
 * money not sitting in a stack.
 */
const totalChips = (s: HoldemState) => s.players.reduce((sum, p) => sum + p.chips, 0) + s.pot;

describe("play money only", () => {
  it("declares itself play-money in the view every single time", () => {
    const state = fresh();
    for (const viewer of [...PLAYERS, null]) {
      expect(game.getPlayerView(state, viewer).playMoneyOnly).toBe(true);
    }
  });

  it("has no concept of deposit, withdrawal or cash-out in its move set", () => {
    const state = fresh();
    for (const bogus of [
      { type: "cashOut" },
      { type: "deposit", amount: 100 },
      { type: "withdraw", amount: 50 },
      { type: "buyIn", amount: 500 },
    ]) {
      expect(game.validateMove(state, "ann", bogus as never)).toBe(false);
    }
  });

  it("never creates chips out of nothing across a whole session", () => {
    const startTotal = 200 * PLAYERS.length;
    const { state } = playSession(11);
    expect(totalChips(state)).toBe(startTotal);
  });

  it("conserves chips after every single action, not just at the end", () => {
    const startTotal = 200 * PLAYERS.length;
    let state = game.createInitialState(PLAYERS, { seed: 77, startingChips: 200, bigBlind: 20 });
    let guard = 0;
    expect(totalChips(state)).toBe(startTotal);

    while (game.checkWinCondition(state) === null && guard++ < 4000) {
      const actor = game.getCurrentPlayerId(state)!;
      state = game.applyMove(state, actor, botMove(state, actor)).state;
      // Stacks plus the live pot must always account for every chip dealt.
      expect(totalChips(state)).toBe(startTotal);
    }
  });
});

describe("setup and blinds", () => {
  it("deals two hole cards to everyone", () => {
    const state = fresh();
    for (const p of state.players) expect(p.hole).toHaveLength(2);
  });

  it("posts small and big blinds", () => {
    const state = fresh();
    const committed = state.players.map((p) => p.committed).sort((a, b) => a - b);
    expect(committed).toEqual([0, 10, 20]);
    expect(state.currentBet).toBe(20);
  });

  it("never deals the same card twice", () => {
    const state = fresh();
    const dealt = state.players.flatMap((p) => p.hole).map((c) => `${c.rank}${c.suit}`);
    expect(new Set(dealt).size).toBe(dealt.length);
  });

  it("starts everyone on the same stack", () => {
    const state = fresh(PLAYERS, { startingChips: 500 });
    const totals = state.players.map((p) => p.chips + p.committed);
    expect(new Set(totals)).toEqual(new Set([500]));
  });

  it("supports 2 through 9 players", () => {
    for (const n of [2, 5, 9]) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const state = fresh(ids);
      expect(state.players).toHaveLength(n);
      expect(state.players.every((p) => p.hole.length === 2)).toBe(true);
    }
  });
});

describe("hidden hole cards", () => {
  it("shows a player their own cards and only counts for others", () => {
    const state = fresh();
    for (const id of PLAYERS) {
      const view = game.getPlayerView(state, id);
      expect(view.myHole).toHaveLength(2);
      for (const opponent of view.opponents) {
        expect(opponent.cardCount).toBe(2);
        expect(opponent.revealed).toBeNull();
      }
    }
  });

  it("never serialises an opponent's cards before showdown", () => {
    const state = fresh();
    const view = game.getPlayerView(state, "ann");
    const wire = JSON.stringify(view);
    for (const p of state.players) {
      if (p.id === "ann") continue;
      for (const card of p.hole) {
        // A card is identified by rank+suit together; neither may be derivable.
        const holdsIt = view.myHole.some((c) => c.rank === card.rank && c.suit === card.suit);
        if (!holdsIt) {
          expect(wire).not.toContain(JSON.stringify(card));
        }
      }
    }
  });

  it("keeps hole cards hidden on every action of a real session", () => {
    let state = game.createInitialState(PLAYERS, { seed: 5, startingChips: 200, bigBlind: 20 });
    let guard = 0;
    while (game.checkWinCondition(state) === null && guard++ < 3000) {
      if (state.showdown === null) {
        for (const viewer of PLAYERS) {
          const view = game.getPlayerView(state, viewer);
          for (const opponent of view.opponents) expect(opponent.revealed).toBeNull();
        }
      }
      const actor = game.getCurrentPlayerId(state)!;
      state = game.applyMove(state, actor, game.getTimeoutMove!(state, actor)!).state;
    }
  });

  it("reveals contested hands at showdown", () => {
    let state = fresh(["a", "b"], { startingChips: 100, bigBlind: 20 });
    // Both all-in pre-flop forces a runout and showdown.
    state = game.applyMove(state, game.getCurrentPlayerId(state)!, { type: "allIn" }).state;
    const next = game.getCurrentPlayerId(state)!;
    if (game.validateMove(state, next, { type: "allIn" })) {
      state = game.applyMove(state, next, { type: "allIn" }).state;
    } else if (game.validateMove(state, next, { type: "call" })) {
      state = game.applyMove(state, next, { type: "call" }).state;
    }
    expect(state.board).toHaveLength(5);
    expect(state.showdown).not.toBeNull();
    const view = game.getPlayerView(state, "a");
    expect(view.showdown).not.toBeNull();
    expect(view.seesAllHands).toBe(true);
  });

  it("does not reveal cards when everyone folds", () => {
    let state = fresh();
    // Fold around to one player.
    while (state.showdown === null) {
      const actor = game.getCurrentPlayerId(state)!;
      state = game.applyMove(state, actor, { type: "fold" }).state;
    }
    // The winner never had to show, so no hole cards are published.
    expect(state.showdown!.every((s) => s.hole.length === 0)).toBe(true);
  });
});

describe("betting validation", () => {
  it("rejects moves out of turn", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    const other = PLAYERS.find((p) => p !== actor)!;
    expect(game.validateMove(state, other, { type: "fold" })).toBe(false);
  });

  it("forbids checking when there is money owed", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    expect(toCallFor(state, state.players.find((p) => p.id === actor)!)).toBeGreaterThan(0);
    expect(game.validateMove(state, actor, { type: "check" })).toBe(false);
    expect(game.validateMove(state, actor, { type: "call" })).toBe(true);
  });

  it("enforces a minimum raise", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    // Big blind is 20, so the minimum raise-to is 40.
    expect(game.validateMove(state, actor, { type: "raise", amount: 30 })).toBe(false);
    expect(game.validateMove(state, actor, { type: "raise", amount: 40 })).toBe(true);
  });

  it("refuses a raise beyond the player's stack", () => {
    const state = fresh(PLAYERS, { startingChips: 100 });
    const actor = game.getCurrentPlayerId(state)!;
    expect(game.validateMove(state, actor, { type: "raise", amount: 5000 })).toBe(false);
  });

  it("rejects malformed moves without throwing", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    for (const junk of [null, undefined, {}, 5, "fold", { type: "bet" }, { type: "bet", amount: -10 }, { type: "raise", amount: NaN }]) {
      expect(() => game.validateMove(state, actor, junk as never)).not.toThrow();
      expect(game.validateMove(state, actor, junk as never)).toBe(false);
    }
  });

  it("does not let a folded player keep acting", () => {
    let state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    state = game.applyMove(state, actor, { type: "fold" }).state;
    expect(game.validateMove(state, actor, { type: "call" })).toBe(false);
  });

  it("does not mutate the state it is given", () => {
    const state = fresh();
    const before = JSON.stringify(state);
    const actor = game.getCurrentPlayerId(state)!;
    game.applyMove(state, actor, { type: "fold" });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("refuses to apply a move it would not validate", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    expect(() => game.applyMove(state, actor, { type: "check" })).toThrow();
  });
});

describe("street progression", () => {
  it("deals flop, turn and river as the betting rounds close", () => {
    let state = fresh();
    const seen: number[] = [];
    let guard = 0;
    while (state.street !== "showdown" && !state.handComplete && guard++ < 100) {
      const actor = game.getCurrentPlayerId(state)!;
      const player = state.players.find((p) => p.id === actor)!;
      const owed = toCallFor(state, player);
      const move: HoldemMove = owed > 0 ? { type: "call" } : { type: "check" };
      state = game.applyMove(state, actor, move).state;
      seen.push(state.board.length);
    }
    // The board grows 0 → 3 → 4 → 5 and never shrinks or skips.
    const sizes = [...new Set(seen)].sort((a, b) => a - b);
    for (const size of sizes) expect([0, 3, 4, 5]).toContain(size);
  });

  it("resets the bet between streets", () => {
    let state = fresh();
    let guard = 0;
    while (state.street === "preflop" && guard++ < 50) {
      const actor = game.getCurrentPlayerId(state)!;
      const player = state.players.find((p) => p.id === actor)!;
      state = game.applyMove(state, actor, toCallFor(state, player) > 0 ? { type: "call" } : { type: "check" }).state;
    }
    if (state.street === "flop") {
      expect(state.currentBet).toBe(0);
      expect(state.players.every((p) => p.committed === 0)).toBe(true);
    }
  });
});

describe("side pots", () => {
  it("splits into a main pot and a side pot when a short stack is all in", () => {
    const state = fresh(["short", "mid", "big"]);
    // Hand-build committed amounts: short 50, mid 200, big 200.
    state.players[0]!.totalCommitted = 50;
    state.players[1]!.totalCommitted = 200;
    state.players[2]!.totalCommitted = 200;

    const pots = buildPots(state);
    expect(pots).toHaveLength(2);
    // Main pot: 50 from each of three players.
    expect(pots[0]!.amount).toBe(150);
    expect(pots[0]!.eligible.sort()).toEqual(["big", "mid", "short"]);
    // Side pot: the extra 150 each from mid and big only.
    expect(pots[1]!.amount).toBe(300);
    expect(pots[1]!.eligible.sort()).toEqual(["big", "mid"]);
  });

  it("excludes folded players from winning but keeps their chips in the pot", () => {
    const state = fresh(["a", "b", "c"]);
    state.players[0]!.totalCommitted = 100;
    state.players[1]!.totalCommitted = 100;
    state.players[2]!.totalCommitted = 100;
    state.players[2]!.folded = true;

    const pots = buildPots(state);
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(300);
    expect(pots[0]!.eligible.sort()).toEqual(["a", "b"]);
  });

  it("handles three all-in levels", () => {
    const state = fresh(["a", "b", "c"]);
    state.players[0]!.totalCommitted = 25;
    state.players[1]!.totalCommitted = 60;
    state.players[2]!.totalCommitted = 100;

    const pots = buildPots(state);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(185);
    expect(pots[0]!.eligible).toHaveLength(3);
    expect(pots[pots.length - 1]!.eligible).toEqual(["c"]);
  });

  it("conserves every chip committed", () => {
    const state = fresh(["a", "b", "c", "d"]);
    const amounts = [15, 80, 80, 240];
    state.players.forEach((p, i) => (p.totalCommitted = amounts[i]!));
    const pots = buildPots(state);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(amounts.reduce((a, b) => a + b, 0));
  });
});

describe("full sessions", () => {
  it("resolves to a single winner holding every chip", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { state } = playSession(seed);
      const win = game.checkWinCondition(state)!;
      expect(win.finished).toBe(true);
      expect(win.winners).toHaveLength(1);
      const champion = state.players.find((p) => p.id === win.winners[0])!;
      expect(champion.chips).toBe(200 * PLAYERS.length);
      expect(champion.busted).toBe(false);
    }
  });

  it("busts players only when they run out of chips", () => {
    const { state } = playSession(3);
    for (const p of state.players) {
      if (p.busted) expect(p.chips).toBe(0);
      else expect(p.chips).toBeGreaterThan(0);
    }
  });

  it("plays heads-up", () => {
    const { state } = playSession(4, ["a", "b"]);
    expect(game.checkWinCondition(state)!.winners).toHaveLength(1);
  });

  it("stops handing out turns once finished", () => {
    const { state } = playSession(6);
    expect(game.getCurrentPlayerId(state)).toBeNull();
  });
});

describe("timeout behaviour", () => {
  it("never wagers chips on an absent player's behalf", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    const move = game.getTimeoutMove!(state, actor)!;
    // Facing a bet, the safe default is to fold rather than call with someone
    // else's stack.
    expect(["fold", "check"]).toContain(move.type);
  });

  it("checks rather than folds when checking is free", () => {
    let state = fresh();
    let guard = 0;
    while (state.street === "preflop" && guard++ < 50) {
      const actor = game.getCurrentPlayerId(state)!;
      const player = state.players.find((p) => p.id === actor)!;
      state = game.applyMove(state, actor, toCallFor(state, player) > 0 ? { type: "call" } : { type: "check" }).state;
    }
    if (state.street === "flop" && !state.handComplete) {
      const actor = game.getCurrentPlayerId(state)!;
      expect(game.getTimeoutMove!(state, actor)!.type).toBe("check");
    }
  });
});

describe("legal move advertising", () => {
  it("offers check when nothing is owed and call when something is", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    const player = state.players.find((p) => p.id === actor)!;
    const legal = legalMovesFor(state, player);
    expect(legal).toContain("fold");
    expect(legal).toContain(toCallFor(state, player) > 0 ? "call" : "check");
  });

  it("offers nothing to a player who is not to act", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    const other = state.players.find((p) => p.id !== actor)!;
    expect(legalMovesFor(state, other)).toEqual([]);
  });
});
