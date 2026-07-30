import { describe, it, expect } from "vitest";
import { whotModule as game, playableCards, type WhotMove, type WhotState } from "./module";
import { buildDeck, cardValue, handTotal, canPlay, type WhotCard } from "./deck";
import {
  BRITISH_WADDINGTONS,
  CLASSIC_NIGERIAN,
  OLD_SCHOOL,
  SUDDEN_DEATH,
  SUIT_NUMBERS,
  SHAPES,
  WHOT_VARIANTS,
  getVariant,
} from "./rules";

const PLAYERS = ["ada", "bo", "chi", "dee"];

/** Plays a whole match using only the GameModule surface. */
function playMatch(seed: number, variant = "classic-nigerian", players = PLAYERS) {
  let state = game.createInitialState(players, { seed, variant });
  let moves = 0;
  const events = [];

  while (game.checkWinCondition(state) === null) {
    if (moves++ > 4000) throw new Error(`seed ${seed} did not terminate`);
    const actor = game.getCurrentPlayerId(state);
    if (!actor) throw new Error("no current player mid-match");

    const move = game.getTimeoutMove!(state, actor);
    expect(move).not.toBeNull();
    expect(game.validateMove(state, actor, move!)).toBe(true);
    const result = game.applyMove(state, actor, move!);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events, moves };
}

describe("deck composition (verified against pagat.com / Wikipedia)", () => {
  it("builds a 54-card Nigerian pack", () => {
    const deck = buildDeck(CLASSIC_NIGERIAN);
    expect(deck).toHaveLength(54);
    expect(deck.filter((c) => c.shape === "whot")).toHaveLength(5);
  });

  it("builds a 53-card British pack with 4 Whot cards", () => {
    const deck = buildDeck(BRITISH_WADDINGTONS);
    expect(deck).toHaveLength(53);
    expect(deck.filter((c) => c.shape === "whot")).toHaveLength(4);
  });

  it("uses the correct, unequal suit sizes", () => {
    const deck = buildDeck(CLASSIC_NIGERIAN);
    const count = (shape: string) => deck.filter((c) => c.shape === shape).length;
    expect(count("circle")).toBe(12);
    expect(count("triangle")).toBe(12);
    expect(count("cross")).toBe(9);
    expect(count("square")).toBe(9);
    // Stars are the classic trap: 7 cards, and there is no Star 6.
    expect(count("star")).toBe(7);
  });

  it("omits 6 and 9 everywhere, and omits 4/8/12 from crosses and squares", () => {
    for (const shape of SHAPES) {
      expect(SUIT_NUMBERS[shape]).not.toContain(6);
      expect(SUIT_NUMBERS[shape]).not.toContain(9);
    }
    for (const shape of ["cross", "square"] as const) {
      for (const absent of [4, 8, 12]) expect(SUIT_NUMBERS[shape]).not.toContain(absent);
    }
    expect(SUIT_NUMBERS.star).toEqual([1, 2, 3, 4, 5, 7, 8]);
  });

  it("gives every card a unique id", () => {
    const deck = buildDeck(CLASSIC_NIGERIAN);
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
  });
});

describe("card values", () => {
  it("scores stars double and Whot as 20", () => {
    const star: WhotCard = { id: "star-8", shape: "star", number: 8 };
    const circle: WhotCard = { id: "circle-8", shape: "circle", number: 8 };
    const whot: WhotCard = { id: "whot-0", shape: "whot", number: 20 };
    expect(cardValue(star, CLASSIC_NIGERIAN)).toBe(16);
    expect(cardValue(circle, CLASSIC_NIGERIAN)).toBe(8);
    expect(cardValue(whot, CLASSIC_NIGERIAN)).toBe(20);
  });

  it("respects a variant that turns off double-scoring stars", () => {
    const rules = { ...CLASSIC_NIGERIAN, starsCountDouble: false };
    expect(cardValue({ id: "s", shape: "star", number: 8 }, rules)).toBe(8);
  });

  it("totals a hand", () => {
    const hand: WhotCard[] = [
      { id: "a", shape: "circle", number: 5 },
      { id: "b", shape: "star", number: 3 },
      { id: "c", shape: "whot", number: 20 },
    ];
    expect(handTotal(hand, CLASSIC_NIGERIAN)).toBe(5 + 6 + 20);
  });
});

describe("matching rules", () => {
  const rules = CLASSIC_NIGERIAN;
  const top: WhotCard = { id: "circle-5", shape: "circle", number: 5 };

  it("matches on shape or number", () => {
    expect(canPlay({ id: "x", shape: "circle", number: 11 }, top, null, rules)).toBe(true);
    expect(canPlay({ id: "y", shape: "square", number: 5 }, top, null, rules)).toBe(true);
    expect(canPlay({ id: "z", shape: "square", number: 11 }, top, null, rules)).toBe(false);
  });

  it("always allows a Whot wildcard", () => {
    expect(canPlay({ id: "w", shape: "whot", number: 20 }, top, null, rules)).toBe(true);
  });

  it("honours a demanded shape over the top card", () => {
    expect(canPlay({ id: "a", shape: "star", number: 2 }, top, "star", rules)).toBe(true);
    // Same number as the top card is not enough once a shape is demanded.
    expect(canPlay({ id: "b", shape: "square", number: 5 }, top, "star", rules)).toBe(false);
  });
});

describe("full matches through the module interface", () => {
  it.each(WHOT_VARIANTS.map((v) => v.id))("terminates with a winner (%s)", (variant) => {
    for (let seed = 1; seed <= 12; seed++) {
      const { state } = playMatch(seed, variant);
      const win = game.checkWinCondition(state);
      expect(win).not.toBeNull();
      expect(win!.finished).toBe(true);
      expect(win!.winners.length).toBeGreaterThan(0);
    }
  });

  it("conserves every card in the pack across a whole match", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = playMatch(seed);
      const total =
        state.market.length +
        state.pile.length +
        state.players.reduce((sum, p) => sum + p.hand.length, 0);
      expect(total).toBe(54);
    }
  });

  it("ends because someone emptied their hand", () => {
    const { state } = playMatch(3);
    if (state.endReason === "emptyHand") {
      const winner = state.players.find((p) => p.id === state.winners[0])!;
      expect(winner.hand).toHaveLength(0);
    }
  });

  it("never leaves the turn on a player once the match is over", () => {
    const { state } = playMatch(5);
    expect(game.getCurrentPlayerId(state)).toBeNull();
  });

  it("plays two-handed and six-handed matches", () => {
    for (const count of [2, 6]) {
      const players = PLAYERS.concat(["eve", "fay"]).slice(0, count);
      const { state } = playMatch(21, "classic-nigerian", players);
      expect(game.checkWinCondition(state)!.finished).toBe(true);
    }
  });
});

describe("hidden hands — getPlayerView", () => {
  it("shows a player their own hand and only counts for others", () => {
    const state = game.createInitialState(PLAYERS, { seed: 8 });
    for (const id of PLAYERS) {
      const view = game.getPlayerView(state, id);
      expect(view.myHand).toHaveLength(CLASSIC_NIGERIAN.handSize);
      expect(view.opponents).toHaveLength(PLAYERS.length - 1);
      for (const opponent of view.opponents) {
        expect(opponent.cardCount).toBe(CLASSIC_NIGERIAN.handSize);
        // The shape of the payload must offer no way to name a card.
        expect(Object.keys(opponent)).toEqual(["id", "cardCount"]);
      }
    }
  });

  it("never serialises another player's cards anywhere in the payload", () => {
    const state = game.createInitialState(PLAYERS, { seed: 12 });
    const view = game.getPlayerView(state, "ada");
    const wire = JSON.stringify(view);
    for (const player of state.players) {
      if (player.id === "ada") continue;
      for (const card of player.hand) {
        // A card id would identify the exact card; none may appear.
        const heldByViewer = view.myHand.some((c) => c.id === card.id);
        if (!heldByViewer) expect(wire).not.toContain(`"${card.id}"`);
      }
    }
    expect(view.allHands).toEqual({});
  });

  it("keeps hands hidden on every turn of a real match", () => {
    let state = game.createInitialState(PLAYERS, { seed: 15 });
    let guard = 0;
    while (game.checkWinCondition(state) === null && guard++ < 2000) {
      for (const viewer of PLAYERS) {
        const view = game.getPlayerView(state, viewer);
        expect(view.allHands).toEqual({});
        const mine = state.players.find((p) => p.id === viewer)!;
        expect(view.myHand.map((c) => c.id).sort()).toEqual(mine.hand.map((c) => c.id).sort());
      }
      const actor = game.getCurrentPlayerId(state)!;
      state = game.applyMove(state, actor, game.getTimeoutMove!(state, actor)!).state;
    }
  });

  it("opens every hand to a spectator", () => {
    const state = game.createInitialState(PLAYERS, { seed: 2 });
    const view = game.getPlayerView(state, null);
    expect(view.seesAllHands).toBe(true);
    expect(Object.keys(view.allHands)).toHaveLength(PLAYERS.length);
    expect(view.myHand).toEqual([]);
  });

  it("reveals hands and totals once the match is finished", () => {
    const { state } = playMatch(4);
    const view = game.getPlayerView(state, "ada");
    expect(view.finished).toBe(true);
    expect(view.seesAllHands).toBe(true);
    expect(view.handTotals).not.toBeNull();
  });

  it("only offers playable cards to the player whose turn it is", () => {
    const state = game.createInitialState(PLAYERS, { seed: 6 });
    const actor = game.getCurrentPlayerId(state)!;
    const other = PLAYERS.find((p) => p !== actor)!;
    expect(game.getPlayerView(state, other).playableCardIds).toEqual([]);
    const actorView = game.getPlayerView(state, actor);
    for (const id of actorView.playableCardIds) {
      expect(actorView.myHand.some((c) => c.id === id)).toBe(true);
    }
  });
});

describe("special cards", () => {
  /** Builds a controlled state so a specific special can be exercised. */
  function rigged(over: Partial<WhotState> = {}, variant = CLASSIC_NIGERIAN): WhotState {
    const base = game.createInitialState(["p1", "p2", "p3"], { seed: 1, variant: variant.id });
    return { ...base, ...over } as WhotState;
  }

  it("Hold On lets the same player act again", () => {
    const state = rigged();
    state.pile = [{ id: "circle-7", shape: "circle", number: 7 }];
    state.players[0]!.hand = [
      { id: "circle-1", shape: "circle", number: 1 },
      { id: "square-13", shape: "square", number: 13 },
    ];
    const { state: after, events } = game.applyMove(state, "p1", { type: "play", cardId: "circle-1" });
    expect(game.getCurrentPlayerId(after)).toBe("p1");
    expect(events.some((e) => e.type === "holdOn")).toBe(true);
  });

  it("Pick Two puts a 2-card debt on the next player", () => {
    const state = rigged();
    state.pile = [{ id: "circle-7", shape: "circle", number: 7 }];
    state.players[0]!.hand = [
      { id: "circle-2", shape: "circle", number: 2 },
      { id: "square-13", shape: "square", number: 13 },
    ];
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: "circle-2" });
    expect(after.pendingDraw).toBe(2);
    expect(after.pendingKind).toBe("pickTwo");
    expect(game.getCurrentPlayerId(after)).toBe("p2");
  });

  it("stacks Pick Two when the variant allows it", () => {
    const state = rigged();
    state.pile = [{ id: "circle-2", shape: "circle", number: 2 }];
    state.currentIndex = 1;
    state.pendingDraw = 2;
    state.pendingKind = "pickTwo";
    state.players[1]!.hand = [
      { id: "square-2", shape: "square", number: 2 },
      { id: "star-3", shape: "star", number: 3 },
    ];
    // Only the counter-card is legal while a debt stands.
    expect(playableCards(state, "p2").map((c) => c.id)).toEqual(["square-2"]);
    const { state: after } = game.applyMove(state, "p2", { type: "play", cardId: "square-2" });
    expect(after.pendingDraw).toBe(4);
  });

  it("forbids stacking when the variant disallows it", () => {
    const state = rigged({}, BRITISH_WADDINGTONS);
    state.rules = BRITISH_WADDINGTONS;
    state.pile = [{ id: "circle-2", shape: "circle", number: 2 }];
    state.currentIndex = 1;
    state.pendingDraw = 2;
    state.pendingKind = "pickTwo";
    state.players[1]!.hand = [{ id: "square-2", shape: "square", number: 2 }];
    expect(playableCards(state, "p2")).toHaveLength(0);
    // Drawing remains legal — it is how the debt gets paid.
    expect(game.validateMove(state, "p2", { type: "draw" })).toBe(true);
  });

  it("pays the accumulated debt on a draw", () => {
    const state = rigged();
    state.currentIndex = 1;
    state.pendingDraw = 5;
    state.pendingKind = "pickThree";
    const before = state.players[1]!.hand.length;
    const { state: after } = game.applyMove(state, "p2", { type: "draw" });
    expect(after.players[1]!.hand).toHaveLength(before + 5);
    expect(after.pendingDraw).toBe(0);
  });

  it("Pick Three adds three", () => {
    const state = rigged();
    state.pile = [{ id: "circle-7", shape: "circle", number: 7 }];
    state.players[0]!.hand = [
      { id: "circle-5", shape: "circle", number: 5 },
      { id: "square-13", shape: "square", number: 13 },
    ];
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: "circle-5" });
    expect(after.pendingDraw).toBe(3);
  });

  it("Suspension skips the next player", () => {
    const state = rigged();
    state.pile = [{ id: "circle-7", shape: "circle", number: 7 }];
    state.players[0]!.hand = [
      { id: "circle-8", shape: "circle", number: 8 },
      { id: "square-13", shape: "square", number: 13 },
    ];
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: "circle-8" });
    expect(game.getCurrentPlayerId(after)).toBe("p3");
  });

  it("Star 8 skips two players when the variant says so", () => {
    const rules = { ...CLASSIC_NIGERIAN, starSuspensionSkipsTwo: true };
    const state = rigged();
    state.rules = rules;
    state.pile = [{ id: "circle-8", shape: "circle", number: 8 }];
    state.players[0]!.hand = [
      { id: "star-8", shape: "star", number: 8 },
      { id: "square-13", shape: "square", number: 13 },
    ];
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: "star-8" });
    // 3 players: skipping two lands back on the player after next.
    expect(game.getCurrentPlayerId(after)).toBe("p1");
  });

  it("General Market makes everyone else draw one", () => {
    const state = rigged();
    state.pile = [{ id: "circle-7", shape: "circle", number: 7 }];
    state.players[0]!.hand = [
      { id: "circle-14", shape: "circle", number: 14 },
      { id: "square-13", shape: "square", number: 13 },
    ];
    const before = state.players.map((p) => p.hand.length);
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: "circle-14" });
    expect(after.players[1]!.hand).toHaveLength(before[1]! + 1);
    expect(after.players[2]!.hand).toHaveLength(before[2]! + 1);
    // The player who played it does not draw (they also lost the card).
    expect(after.players[0]!.hand).toHaveLength(before[0]! - 1);
  });

  it("Whot demands a shape, which then constrains the next player", () => {
    const state = rigged();
    state.pile = [{ id: "circle-7", shape: "circle", number: 7 }];
    state.players[0]!.hand = [
      { id: "whot-0", shape: "whot", number: 20 },
      { id: "square-13", shape: "square", number: 13 },
    ];
    state.players[1]!.hand = [
      { id: "star-3", shape: "star", number: 3 },
      { id: "circle-11", shape: "circle", number: 11 },
    ];
    const { state: after, events } = game.applyMove(state, "p1", {
      type: "play",
      cardId: "whot-0",
      requestShape: "star",
    });
    expect(after.requestedShape).toBe("star");
    expect(events.some((e) => e.type === "wild")).toBe(true);
    expect(playableCards(after, "p2").map((c) => c.id)).toEqual(["star-3"]);
  });

  it("treats specials as ordinary cards in the Old School variant", () => {
    const state = rigged({}, OLD_SCHOOL);
    state.rules = OLD_SCHOOL;
    state.pile = [{ id: "circle-7", shape: "circle", number: 7 }];
    state.players[0]!.hand = [
      { id: "circle-2", shape: "circle", number: 2 },
      { id: "square-13", shape: "square", number: 13 },
    ];
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: "circle-2" });
    expect(after.pendingDraw).toBe(0);
    expect(game.getCurrentPlayerId(after)).toBe("p2");
  });
});

describe("market exhaustion", () => {
  it("reshuffles the pile back into the market under the default rules", () => {
    const state = game.createInitialState(["p1", "p2"], { seed: 30 });
    state.market = [];
    state.pile = [
      { id: "circle-3", shape: "circle", number: 3 },
      { id: "square-11", shape: "square", number: 11 },
      { id: "star-4", shape: "star", number: 4 },
    ];
    const { state: after, events } = game.applyMove(state, "p1", { type: "draw" });
    expect(events.some((e) => e.type === "reshuffle")).toBe(true);
    expect(after.pile).toHaveLength(1);
    expect(after.finished).toBe(false);
  });

  it("ends on hand totals when the variant says so", () => {
    const state = game.createInitialState(["p1", "p2"], { seed: 31, variant: SUDDEN_DEATH.id });
    state.market = [];
    state.players[0]!.hand = [{ id: "circle-1", shape: "circle", number: 1 }];
    state.players[1]!.hand = [{ id: "star-8", shape: "star", number: 8 }];
    const { state: after } = game.applyMove(state, "p1", { type: "draw" });
    expect(after.finished).toBe(true);
    expect(after.endReason).toBe("marketExhausted");
    // p1 holds 1 point, p2 holds 16 (star doubles) — lowest total wins.
    expect(after.winners).toEqual(["p1"]);
  });

  it("supports the inverted house rule where the lowest total loses", () => {
    const rules = { ...SUDDEN_DEATH, id: "inverted", onMarketExhausted: "lowestTotalLoses" as const };
    const state = game.createInitialState(["p1", "p2"], { seed: 32 });
    state.rules = rules;
    state.market = [];
    state.players[0]!.hand = [{ id: "circle-1", shape: "circle", number: 1 }];
    state.players[1]!.hand = [{ id: "star-8", shape: "star", number: 8 }];
    const { state: after } = game.applyMove(state, "p1", { type: "draw" });
    expect(after.finished).toBe(true);
    expect(after.winners).toEqual(["p2"]);
  });
});

describe("validateMove", () => {
  it("rejects moves from the wrong player", () => {
    const state = game.createInitialState(PLAYERS, { seed: 1 });
    const actor = game.getCurrentPlayerId(state)!;
    const other = PLAYERS.find((p) => p !== actor)!;
    expect(game.validateMove(state, other, { type: "draw" })).toBe(false);
  });

  it("rejects a card the player does not hold", () => {
    const state = game.createInitialState(PLAYERS, { seed: 1 });
    const actor = game.getCurrentPlayerId(state)!;
    expect(game.validateMove(state, actor, { type: "play", cardId: "no-such-card" })).toBe(false);
  });

  it("rejects malformed moves without throwing", () => {
    const state = game.createInitialState(PLAYERS, { seed: 1 });
    const actor = game.getCurrentPlayerId(state)!;
    for (const junk of [null, undefined, {}, 7, "draw", { type: "play" }, { type: "play", cardId: 5 }, { type: "nope" }]) {
      expect(() => game.validateMove(state, actor, junk as never)).not.toThrow();
      expect(game.validateMove(state, actor, junk as never)).toBe(false);
    }
  });

  it("rejects a wildcard naming something that is not a shape", () => {
    const state = game.createInitialState(PLAYERS, { seed: 1 });
    const actor = game.getCurrentPlayerId(state)!;
    const move = { type: "play", cardId: "whot-0", requestShape: "hexagon" } as unknown as WhotMove;
    expect(game.validateMove(state, actor, move)).toBe(false);
  });

  it("can forbid drawing while holding a playable card", () => {
    const state = game.createInitialState(["p1", "p2"], { seed: 40 });
    state.rules = { ...CLASSIC_NIGERIAN, mustPlayIfAble: true };
    state.pile = [{ id: "circle-7", shape: "circle", number: 7 }];
    state.players[0]!.hand = [{ id: "circle-11", shape: "circle", number: 11 }];
    expect(game.validateMove(state, "p1", { type: "draw" })).toBe(false);
  });

  it("does not mutate the state it is given", () => {
    const state = game.createInitialState(PLAYERS, { seed: 1 });
    const before = JSON.stringify(state);
    const actor = game.getCurrentPlayerId(state)!;
    game.applyMove(state, actor, game.getTimeoutMove!(state, actor)!);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("refuses to apply a move it would not validate", () => {
    const state = game.createInitialState(PLAYERS, { seed: 1 });
    const actor = game.getCurrentPlayerId(state)!;
    expect(() => game.applyMove(state, actor, { type: "play", cardId: "nope" })).toThrow();
  });
});

describe("variants", () => {
  it("falls back to the classic rules for an unknown id", () => {
    expect(getVariant("does-not-exist").id).toBe("classic-nigerian");
    expect(getVariant(undefined).id).toBe("classic-nigerian");
  });

  it("exposes every variant with a distinct id", () => {
    const ids = WHOT_VARIANTS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never opens with a wildcard, which would have nothing to match", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const state = game.createInitialState(PLAYERS, { seed });
      expect(state.pile[state.pile.length - 1]!.shape).not.toBe("whot");
    }
  });

  it("deals the configured hand size to everyone", () => {
    const state = game.createInitialState(PLAYERS, { seed: 3 });
    for (const p of state.players) expect(p.hand).toHaveLength(CLASSIC_NIGERIAN.handSize);
  });
});
