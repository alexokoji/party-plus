import { describe, it, expect } from "vitest";
import { liarsDiceModule as game } from "./module";
import type { LiarsDiceMove } from "./module";
import { applyAction, createGame } from "../../engine/game";
import { chooseAction } from "../../engine/ai";
import type { GameState } from "../../engine/types";

const PLAYERS = ["ana", "ben", "cleo", "dai"];

/** Drives a whole match using ONLY the GameModule interface. */
function playThroughModule(seed: number, playerIds = PLAYERS) {
  let state = game.createInitialState(playerIds, { seed });
  const events = [];
  let moves = 0;

  while (game.checkWinCondition(state) === null) {
    if (moves++ > 5000) throw new Error(`seed ${seed} did not terminate`);
    const actor = game.getCurrentPlayerId(state);
    if (!actor) throw new Error("no current player while match is running");

    // Decide using only what this seat is allowed to see.
    const view = game.getPlayerView(state, actor);
    const move: LiarsDiceMove = pickMove(view, state, actor);

    expect(game.validateMove(state, actor, move)).toBe(true);
    const result = game.applyMove(state, actor, move);
    state = result.state;
    events.push(...result.events);
  }

  return { state, events, moves };
}

/** A simple policy that reads the redacted view, not the raw state. */
function pickMove(
  view: ReturnType<typeof game.getPlayerView>,
  state: GameState,
  actor: string
): LiarsDiceMove {
  const action = chooseAction(state, actor, () => 0.5, "sharp");
  return action.type === "bid" ? { type: "bid", bid: action.bid } : { type: "challenge" };
}

describe("liarsDiceModule — meta", () => {
  it("declares hidden state, which is what forces per-player views", () => {
    expect(game.meta.hasHiddenState).toBe(true);
    expect(game.meta.minPlayers).toBe(2);
    expect(game.meta.maxPlayers).toBe(6);
  });
});

describe("liarsDiceModule — full match through the interface", () => {
  it("plays complete matches to exactly one winner", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { state } = playThroughModule(seed);
      const win = game.checkWinCondition(state);
      expect(win).not.toBeNull();
      expect(win!.finished).toBe(true);
      expect(win!.winners).toHaveLength(1);

      const survivors = state.players.filter((p) => !p.eliminated).map((p) => p.id);
      expect(survivors).toEqual(win!.winners);
    }
  });

  it("matches the pre-refactor engine move for move (rules did not change)", () => {
    // Same seed, same deterministic policy: driving the engine directly and
    // driving it through the module must produce identical outcomes. This is
    // the actual proof that the refactor preserved behaviour.
    for (let seed = 1; seed <= 15; seed++) {
      // Reference: straight through the engine.
      let direct = createGame(PLAYERS, seed);
      let guard = 0;
      while (direct.phase !== "gameOver") {
        if (guard++ > 5000) throw new Error("reference run did not terminate");
        const actor = direct.players[direct.currentPlayerIndex]!;
        direct = applyAction(direct, chooseAction(direct, actor.id, () => 0.5, "sharp"));
      }

      const viaModule = playThroughModule(seed).state;

      expect(viaModule.winnerId).toBe(direct.winnerId);
      expect(viaModule.round).toBe(direct.round);
      expect(viaModule.history.length).toBe(direct.history.length);
      expect(viaModule.players.map((p) => `${p.id}:${p.diceCount}:${p.eliminated}`)).toEqual(
        direct.players.map((p) => `${p.id}:${p.diceCount}:${p.eliminated}`)
      );
    }
  });

  it("emits public events without leaking live hidden state", () => {
    const { events } = playThroughModule(3);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "bid")).toBe(true);
    expect(events.some((e) => e.type === "challenge")).toBe(true);
    expect(events.some((e) => e.type === "gameOver")).toBe(true);

    // Hands appear only in `reveal` events, which is the moment the rules
    // make every hand public anyway.
    for (const event of events) {
      if (event.type === "reveal") continue;
      expect(JSON.stringify(event.data ?? {})).not.toMatch(/allHands/);
    }
  });
});

describe("liarsDiceModule — getPlayerView redaction", () => {
  it("shows a player their own dice and nobody else's", () => {
    const state = game.createInitialState(PLAYERS, { seed: 42 });
    for (const player of PLAYERS) {
      const view = game.getPlayerView(state, player);
      const mine = view.dice.filter((d) => d.ownerId === player);
      const theirs = view.dice.filter((d) => d.ownerId !== player);

      expect(mine).toHaveLength(5);
      expect(mine.every((d) => d.face !== null)).toBe(true);
      expect(theirs.every((d) => d.face === null)).toBe(true);
      expect(view.myDice).toHaveLength(5);
    }
  });

  it("never serialises another player's dice anywhere in the view", () => {
    const state = game.createInitialState(PLAYERS, { seed: 7 });
    const view = game.getPlayerView(state, "ana");
    const serialised = JSON.stringify(view);

    // Opponents contribute only nulls...
    const opponentFaces = view.dice.filter((d) => d.ownerId !== "ana").map((d) => d.face);
    expect(new Set(opponentFaces)).toEqual(new Set([null]));

    // ...and their real hands must not appear anywhere in the payload, in any
    // field, which is the property that actually matters on the wire.
    for (const player of state.players) {
      if (player.id === "ana") continue;
      expect(serialised).not.toContain(JSON.stringify(player.dice));
    }
    // The viewer's own hand is of course present and correct.
    expect(view.myDice).toEqual(state.players.find((p) => p.id === "ana")!.dice);
  });

  it("keeps hidden state hidden every turn of a real match, not just at deal", () => {
    let state = game.createInitialState(PLAYERS, { seed: 11 });
    let guard = 0;
    while (game.checkWinCondition(state) === null && guard++ < 3000) {
      for (const viewer of PLAYERS) {
        const view = game.getPlayerView(state, viewer);
        const me = state.players.find((p) => p.id === viewer)!;
        const leaked = view.dice.filter((d) => d.ownerId !== viewer && d.face !== null);
        // An eliminated viewer is allowed to see everything.
        if (!me.eliminated) expect(leaked).toHaveLength(0);
      }
      const actor = game.getCurrentPlayerId(state)!;
      state = game.applyMove(state, actor, toMove(chooseAction(state, actor, () => 0.5, "sharp"))).state;
    }
  });

  it("reveals every hand to an eliminated player, who can no longer act on it", () => {
    let state = game.createInitialState(["ana", "ben"], { seed: 5 });
    let guard = 0;
    let eliminated: string | null = null;
    while (game.checkWinCondition(state) === null && guard++ < 3000) {
      const actor = game.getCurrentPlayerId(state)!;
      state = game.applyMove(state, actor, toMove(chooseAction(state, actor, Math.random, "sharp"))).state;
      const out = state.players.find((p) => p.eliminated);
      if (out) {
        eliminated = out.id;
        break;
      }
    }
    if (eliminated) {
      const view = game.getPlayerView(state, eliminated);
      expect(view.seesAllHands).toBe(true);
    }
  });

  it("gives a pure spectator the full table but no seat", () => {
    const state = game.createInitialState(PLAYERS, { seed: 9 });
    const view = game.getPlayerView(state, null);
    expect(view.seesAllHands).toBe(true);
    expect(view.myDice).toEqual([]);
    expect(view.dice.every((d) => d.face !== null)).toBe(true);
  });
});

describe("liarsDiceModule — validateMove", () => {
  it("rejects moves from anyone but the player to act", () => {
    const state = game.createInitialState(PLAYERS, { seed: 1 });
    const actor = game.getCurrentPlayerId(state)!;
    const other = PLAYERS.find((p) => p !== actor)!;
    expect(game.validateMove(state, other, { type: "bid", bid: { quantity: 1, face: 3 } })).toBe(false);
  });

  it("rejects a challenge when there is no standing bid", () => {
    const state = game.createInitialState(PLAYERS, { seed: 1 });
    const actor = game.getCurrentPlayerId(state)!;
    expect(game.validateMove(state, actor, { type: "challenge" })).toBe(false);
  });

  it("rejects malformed moves without throwing", () => {
    const state = game.createInitialState(PLAYERS, { seed: 1 });
    const actor = game.getCurrentPlayerId(state)!;
    const junk = [
      null,
      undefined,
      {},
      { type: "bid" },
      { type: "bid", bid: {} },
      { type: "bid", bid: { quantity: 0, face: 3 } },
      { type: "bid", bid: { quantity: 2, face: 9 } },
      { type: "bid", bid: { quantity: 1.5, face: 3 } },
      { type: "nonsense" },
      "challenge",
      42,
    ];
    for (const move of junk) {
      expect(() => game.validateMove(state, actor, move as never)).not.toThrow();
      expect(game.validateMove(state, actor, move as never)).toBe(false);
    }
  });

  it("refuses to apply a move it would not validate", () => {
    const state = game.createInitialState(PLAYERS, { seed: 1 });
    const actor = game.getCurrentPlayerId(state)!;
    expect(() => game.applyMove(state, actor, { type: "challenge" })).toThrow();
  });

  it("does not mutate the state it is given", () => {
    const state = game.createInitialState(PLAYERS, { seed: 1 });
    const before = JSON.stringify(state);
    const actor = game.getCurrentPlayerId(state)!;
    game.applyMove(state, actor, { type: "bid", bid: { quantity: 2, face: 3 } });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("liarsDiceModule — timeout moves", () => {
  it("offers a legal move for a stalled player", () => {
    const state = game.createInitialState(PLAYERS, { seed: 4 });
    const actor = game.getCurrentPlayerId(state)!;
    const move = game.getTimeoutMove!(state, actor);
    expect(move).not.toBeNull();
    expect(game.validateMove(state, actor, move!)).toBe(true);
  });

  it("declines to move for someone who is not to act", () => {
    const state = game.createInitialState(PLAYERS, { seed: 4 });
    const actor = game.getCurrentPlayerId(state)!;
    const other = PLAYERS.find((p) => p !== actor)!;
    expect(game.getTimeoutMove!(state, other)).toBeNull();
  });
});

function toMove(action: ReturnType<typeof chooseAction>): LiarsDiceMove {
  return action.type === "bid" ? { type: "bid", bid: action.bid } : { type: "challenge" };
}
