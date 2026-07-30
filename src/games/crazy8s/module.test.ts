import { describe, it, expect } from "vitest";
import {
  activeSuit,
  canPlay,
  crazy8sModule as game,
  playableCards,
  type Crazy8sMove,
  type Crazy8sState,
} from "./module";
import { cardId, type Card, type Suit } from "../holdem/cards";
import {
  CLASSIC_CRAZY_EIGHTS,
  CRAZY8S_VARIANTS,
  getCrazy8sVariant,
  LAST_CARD,
  STRICT,
  UNO_STYLE,
} from "./rules";

const PLAYERS = ["ana", "ben", "cleo"];

const card = (rank: number, suit: Suit): Card => ({ rank, suit });

function fresh(players = PLAYERS, seed = 1, variant = "classic"): Crazy8sState {
  return game.createInitialState(players, { seed, variant });
}

function playMatch(seed: number, variant = "classic", players = PLAYERS) {
  let state = fresh(players, seed, variant);
  let moves = 0;
  while (game.checkWinCondition(state) === null) {
    if (moves++ > 8000) throw new Error(`seed ${seed} (${variant}) did not terminate`);
    const actor = game.getCurrentPlayerId(state)!;
    const move = game.getTimeoutMove!(state, actor)!;
    expect(game.validateMove(state, actor, move)).toBe(true);
    state = game.applyMove(state, actor, move).state;
  }
  return { state, moves };
}

describe("setup", () => {
  it("uses a standard 52-card deck", () => {
    const state = fresh();
    const all = [...state.stock, ...state.pile, ...state.players.flatMap((p) => p.hand)];
    expect(all).toHaveLength(52);
    expect(new Set(all.map(cardId)).size).toBe(52);
  });

  it("deals the configured hand size", () => {
    expect(fresh().players.every((p) => p.hand.length === CLASSIC_CRAZY_EIGHTS.handSize)).toBe(true);
    expect(fresh(PLAYERS, 1, "last-card").players.every((p) => p.hand.length === LAST_CARD.handSize)).toBe(true);
  });

  it("never opens on a wild, which would have no suit to match", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const state = fresh(PLAYERS, seed);
      expect(state.pile[state.pile.length - 1]!.rank).not.toBe(8);
    }
  });

  it("supports 2 to 6 players", () => {
    for (const n of [2, 4, 6]) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      expect(fresh(ids).players).toHaveLength(n);
    }
  });
});

describe("matching", () => {
  it("matches on suit or rank", () => {
    const state = fresh();
    state.pile = [card(9, "h")];
    state.declaredSuit = null;
    expect(canPlay(card(4, "h"), state)).toBe(true);
    expect(canPlay(card(9, "s"), state)).toBe(true);
    expect(canPlay(card(4, "s"), state)).toBe(false);
  });

  it("always allows a wild", () => {
    const state = fresh();
    state.pile = [card(9, "h")];
    expect(canPlay(card(8, "s"), state)).toBe(true);
  });

  it("honours a declared suit over the top card's own suit", () => {
    const state = fresh();
    state.pile = [card(8, "h")];
    state.declaredSuit = "c";
    expect(activeSuit(state)).toBe("c");
    expect(canPlay(card(3, "c"), state)).toBe(true);
    // Same rank is not enough once a suit has been demanded.
    expect(canPlay(card(8, "h"), state)).toBe(true); // wild, still fine
    expect(canPlay(card(9, "h"), state)).toBe(false);
  });
});

describe("wild eights", () => {
  it("lets the player name the next suit", () => {
    const state = fresh(["p1", "p2"]);
    state.pile = [card(9, "h")];
    state.players[0]!.hand = [card(8, "s"), card(2, "d")];
    const { state: after, events } = game.applyMove(state, "p1", {
      type: "play",
      cardId: cardId(card(8, "s")),
      declareSuit: "d",
    });
    expect(after.declaredSuit).toBe("d");
    expect(events.some((e) => e.type === "wild")).toBe(true);
  });

  it("rejects a declared suit that is not a suit", () => {
    const state = fresh(["p1", "p2"]);
    state.pile = [card(9, "h")];
    state.players[0]!.hand = [card(8, "s")];
    const bogus = { type: "play", cardId: cardId(card(8, "s")), declareSuit: "z" } as unknown as Crazy8sMove;
    expect(game.validateMove(state, "p1", bogus)).toBe(false);
  });

  it("constrains the next player to the declared suit", () => {
    const state = fresh(["p1", "p2"]);
    state.pile = [card(9, "h")];
    state.players[0]!.hand = [card(8, "s"), card(3, "c")];
    state.players[1]!.hand = [card(5, "d"), card(9, "c")];
    const { state: after } = game.applyMove(state, "p1", {
      type: "play",
      cardId: cardId(card(8, "s")),
      declareSuit: "d",
    });
    expect(playableCards(after, "p2").map(cardId)).toEqual([cardId(card(5, "d"))]);
  });
});

describe("house rules — draw two", () => {
  it("is off in the classic game", () => {
    const state = fresh(["p1", "p2"], 1, "classic");
    state.pile = [card(9, "h")];
    state.players[0]!.hand = [card(2, "h"), card(4, "c")];
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: cardId(card(2, "h")) });
    expect(after.pendingDraw).toBe(0);
  });

  it("puts a two-card debt on the next player when enabled", () => {
    const state = fresh(["p1", "p2"], 1, "uno-style");
    state.pile = [card(9, "h")];
    state.players[0]!.hand = [card(2, "h"), card(4, "c")];
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: cardId(card(2, "h")) });
    expect(after.pendingDraw).toBe(2);
    expect(game.getCurrentPlayerId(after)).toBe("p2");
  });

  it("stacks when the variant allows it", () => {
    const state = fresh(["p1", "p2"], 1, "uno-style");
    state.pile = [card(2, "h")];
    state.currentIndex = 1;
    state.pendingDraw = 2;
    state.players[1]!.hand = [card(2, "c"), card(9, "h")];
    // Only another two answers a two.
    expect(playableCards(state, "p2").map(cardId)).toEqual([cardId(card(2, "c"))]);
    const { state: after } = game.applyMove(state, "p2", { type: "play", cardId: cardId(card(2, "c")) });
    expect(after.pendingDraw).toBe(4);
  });

  it("forces the whole debt to be picked up on a draw", () => {
    const state = fresh(["p1", "p2"], 1, "uno-style");
    state.currentIndex = 1;
    state.pendingDraw = 4;
    const before = state.players[1]!.hand.length;
    const { state: after } = game.applyMove(state, "p2", { type: "draw" });
    expect(after.players[1]!.hand).toHaveLength(before + 4);
    expect(after.pendingDraw).toBe(0);
  });
});

describe("house rules — skip and reverse", () => {
  it("skips the next player on a configured rank", () => {
    const state = fresh(["p1", "p2", "p3"], 1, "uno-style");
    state.pile = [card(9, "h")];
    state.players[0]!.hand = [card(12, "h"), card(3, "c")]; // Queen skips
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: cardId(card(12, "h")) });
    expect(game.getCurrentPlayerId(after)).toBe("p3");
  });

  it("uses the Jack instead under Last Card rules", () => {
    const state = fresh(["p1", "p2", "p3"], 1, "last-card");
    state.pile = [card(9, "h")];
    state.players[0]!.hand = [card(11, "h"), card(3, "c")];
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: cardId(card(11, "h")) });
    expect(game.getCurrentPlayerId(after)).toBe("p3");
  });

  it("reverses direction with three or more players", () => {
    const state = fresh(["p1", "p2", "p3"], 1, "uno-style");
    state.pile = [card(9, "h")];
    state.players[0]!.hand = [card(14, "h"), card(3, "c")]; // Ace reverses
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: cardId(card(14, "h")) });
    expect(after.direction).toBe(-1);
    expect(game.getCurrentPlayerId(after)).toBe("p3");
  });

  it("treats a reverse as a skip when heads-up", () => {
    const state = fresh(["p1", "p2"], 1, "uno-style");
    state.pile = [card(9, "h")];
    state.players[0]!.hand = [card(14, "h"), card(3, "c")];
    const { state: after } = game.applyMove(state, "p1", { type: "play", cardId: cardId(card(14, "h")) });
    // With two players, turning back round means playing again.
    expect(game.getCurrentPlayerId(after)).toBe("p1");
  });
});

describe("house rules — announcing the last card", () => {
  it("is off in the classic game", () => {
    const state = fresh(["p1", "p2"], 1, "classic");
    state.players[0]!.hand = [card(3, "c")];
    expect(game.validateMove(state, "p1", { type: "announce" })).toBe(false);
    expect(game.getPlayerView(state, "p1").shouldAnnounce).toBe(false);
  });

  it("prompts the player when they are down to one card", () => {
    const state = fresh(["p1", "p2"], 1, "uno-style");
    state.players[0]!.hand = [card(3, "c")];
    expect(game.getPlayerView(state, "p1").shouldAnnounce).toBe(true);
    const { state: after } = game.applyMove(state, "p1", { type: "announce" });
    expect(after.players[0]!.announced).toBe(true);
    expect(game.getPlayerView(after, "p1").shouldAnnounce).toBe(false);
  });

  it("lets an opponent call out a player who forgot", () => {
    const state = fresh(["p1", "p2"], 1, "uno-style");
    state.players[0]!.hand = [card(3, "c")];
    state.players[0]!.announced = false;

    // Callable even though it is not p2's turn — otherwise nobody could catch it.
    expect(game.getPlayerView(state, "p2").callableIds).toEqual(["p1"]);
    expect(game.validateMove(state, "p2", { type: "callOut", targetId: "p1" })).toBe(true);

    const { state: after } = game.applyMove(state, "p2", { type: "callOut", targetId: "p1" });
    expect(after.players[0]!.hand.length).toBe(1 + UNO_STYLE.missedAnnouncementPenalty);
  });

  it("cannot call out a player who did announce", () => {
    const state = fresh(["p1", "p2"], 1, "uno-style");
    state.players[0]!.hand = [card(3, "c")];
    state.players[0]!.announced = true;
    expect(game.validateMove(state, "p2", { type: "callOut", targetId: "p1" })).toBe(false);
    expect(game.getPlayerView(state, "p2").callableIds).toEqual([]);
  });

  it("clears the announcement when the player picks cards back up", () => {
    const state = fresh(["p1", "p2"], 1, "uno-style");
    state.players[0]!.hand = [card(3, "c")];
    state.players[0]!.announced = true;
    state.currentIndex = 0;
    state.pendingDraw = 2;
    const { state: after } = game.applyMove(state, "p1", { type: "draw" });
    expect(after.players[0]!.announced).toBe(false);
  });
});

describe("drawing", () => {
  it("can forbid drawing while holding a playable card", () => {
    const state = fresh(["p1", "p2"], 1, "strict");
    state.pile = [card(9, "h")];
    state.players[0]!.hand = [card(4, "h")];
    expect(STRICT.mustPlayIfAble).toBe(true);
    expect(game.validateMove(state, "p1", { type: "draw" })).toBe(false);
  });

  it("allows passing only after drawing with nothing playable", () => {
    const state = fresh(["p1", "p2"], 1, "last-card");
    state.pile = [card(9, "h")];
    state.players[0]!.hand = [card(4, "c")];
    expect(game.validateMove(state, "p1", { type: "pass" })).toBe(false);
    state.drawnThisTurn = 1;
    expect(game.validateMove(state, "p1", { type: "pass" })).toBe(true);
  });

  it("reshuffles the discards when the stock runs out", () => {
    const state = fresh(["p1", "p2"]);
    state.stock = [];
    state.pile = [card(9, "h"), card(4, "c"), card(6, "d")];
    const { state: after, events } = game.applyMove(state, "p1", { type: "draw" });
    expect(events.some((e) => e.type === "reshuffle")).toBe(true);
    expect(after.pile).toHaveLength(1);
  });
});

describe("hidden hands", () => {
  it("shows a player their own hand and only counts for others", () => {
    const state = fresh();
    for (const id of PLAYERS) {
      const view = game.getPlayerView(state, id);
      expect(view.myHand).toHaveLength(CLASSIC_CRAZY_EIGHTS.handSize);
      for (const opponent of view.opponents) {
        expect(opponent.cardCount).toBe(CLASSIC_CRAZY_EIGHTS.handSize);
        expect(Object.keys(opponent).sort()).toEqual(["announced", "cardCount", "id"]);
      }
      expect(view.allHands).toEqual({});
    }
  });

  it("never serialises an opponent's cards", () => {
    const state = fresh();
    const view = game.getPlayerView(state, "ana");
    const wire = JSON.stringify(view);
    for (const p of state.players) {
      if (p.id === "ana") continue;
      for (const c of p.hand) {
        const mine = view.myHand.some((m) => cardId(m) === cardId(c));
        if (!mine) expect(wire).not.toContain(JSON.stringify(c));
      }
    }
  });

  it("keeps hands hidden on every turn of a real match", () => {
    let state = fresh(PLAYERS, 9);
    let guard = 0;
    while (game.checkWinCondition(state) === null && guard++ < 4000) {
      for (const viewer of PLAYERS) {
        expect(game.getPlayerView(state, viewer).allHands).toEqual({});
      }
      const actor = game.getCurrentPlayerId(state)!;
      state = game.applyMove(state, actor, game.getTimeoutMove!(state, actor)!).state;
    }
  });

  it("opens every hand to a spectator", () => {
    const view = game.getPlayerView(fresh(), null);
    expect(view.seesAllHands).toBe(true);
    expect(Object.keys(view.allHands)).toHaveLength(PLAYERS.length);
    expect(view.myHand).toEqual([]);
  });

  it("only offers playable cards to the player to act", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    const other = PLAYERS.find((p) => p !== actor)!;
    expect(game.getPlayerView(state, other).playableCardIds).toEqual([]);
  });
});

describe("full matches", () => {
  it.each(CRAZY8S_VARIANTS.map((v) => v.id))("terminates with a single winner (%s)", (variant) => {
    for (let seed = 1; seed <= 8; seed++) {
      const { state } = playMatch(seed, variant);
      const win = game.checkWinCondition(state)!;
      expect(win.finished).toBe(true);
      expect(win.winners).toHaveLength(1);
      expect(state.players.find((p) => p.id === win.winners[0])!.hand).toHaveLength(0);
    }
  });

  it("conserves all 52 cards throughout", () => {
    const { state } = playMatch(4);
    const all = state.stock.length + state.pile.length + state.players.reduce((s, p) => s + p.hand.length, 0);
    expect(all).toBe(52);
  });

  it("plays heads-up and six-handed", () => {
    expect(game.checkWinCondition(playMatch(2, "classic", ["a", "b"]).state)!.winners).toHaveLength(1);
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(game.checkWinCondition(playMatch(3, "classic", six).state)!.winners).toHaveLength(1);
  });
});

describe("validation", () => {
  it("rejects moves out of turn", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    const other = PLAYERS.find((p) => p !== actor)!;
    expect(game.validateMove(state, other, { type: "draw" })).toBe(false);
  });

  it("rejects a card the player does not hold", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    expect(game.validateMove(state, actor, { type: "play", cardId: "nonsense" })).toBe(false);
  });

  it("rejects malformed moves without throwing", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    for (const junk of [null, undefined, {}, 4, "draw", { type: "play" }, { type: "play", cardId: 7 }, { type: "callOut" }]) {
      expect(() => game.validateMove(state, actor, junk as never)).not.toThrow();
      expect(game.validateMove(state, actor, junk as never)).toBe(false);
    }
  });

  it("does not mutate the state it is given", () => {
    const state = fresh();
    const before = JSON.stringify(state);
    const actor = game.getCurrentPlayerId(state)!;
    game.applyMove(state, actor, game.getTimeoutMove!(state, actor)!);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("refuses to apply a move it would not validate", () => {
    const state = fresh();
    const actor = game.getCurrentPlayerId(state)!;
    expect(() => game.applyMove(state, actor, { type: "play", cardId: "nope" })).toThrow();
  });
});

describe("variants", () => {
  it("falls back to classic for an unknown id", () => {
    expect(getCrazy8sVariant("nope").id).toBe("classic");
    expect(getCrazy8sVariant(undefined).id).toBe("classic");
  });

  it("exposes distinct ids", () => {
    const ids = CRAZY8S_VARIANTS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shares one engine across dialects — only config differs", () => {
    // Same module, same deck, different behaviour purely from the rules object.
    expect(LAST_CARD.drawTwoRank).toBe(2);
    expect(CLASSIC_CRAZY_EIGHTS.drawTwoRank).toBeNull();
    expect(UNO_STYLE.skipRanks).toEqual([12]);
    expect(LAST_CARD.skipRanks).toEqual([11]);
  });
});
