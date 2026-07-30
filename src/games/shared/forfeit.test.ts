import { describe, it, expect } from "vitest";
import { ludoModule } from "../ludo/module";
import { snakesModule } from "../snakes/module";
import { crazy8sModule } from "../crazy8s/module";
import { whotModule } from "../whot/module";
import { liarsDiceModule } from "../liars-dice/module";
import type { AnyGameModule } from "../../platform/types";

/**
 * Turn-clock contract shared by every module.
 *
 * The rule the room engine relies on: running out of time costs you your
 * turn, it does not commit you to a move you never made. Games that can skip
 * a player implement forfeitTurn; the rest must still offer a safe fallback.
 */
const SKIPPABLE: Array<[string, AnyGameModule, string[]]> = [
  ["ludo", ludoModule, ["a", "b", "c"]],
  ["snakes", snakesModule, ["a", "b", "c"]],
  ["crazy8s", crazy8sModule, ["a", "b", "c"]],
  ["whot", whotModule, ["a", "b", "c"]],
];

describe("forfeitTurn — skippable games", () => {
  it.each(SKIPPABLE)("%s passes the turn to the next player", (_name, game, players) => {
    const state = game.createInitialState(players, { seed: 5 });
    const actor = game.getCurrentPlayerId(state)!;

    const after = game.forfeitTurn!(state, actor);
    expect(after).not.toBeNull();

    const next = game.getCurrentPlayerId(after);
    expect(next).not.toBe(actor);
    expect(players).toContain(next);
  });

  it.each(SKIPPABLE)("%s does not mutate the state it is given", (_name, game, players) => {
    const state = game.createInitialState(players, { seed: 6 });
    const before = JSON.stringify(state);
    game.forfeitTurn!(state, game.getCurrentPlayerId(state)!);
    expect(JSON.stringify(state)).toBe(before);
  });

  it.each(SKIPPABLE)("%s refuses to forfeit for a player who is not to act", (_name, game, players) => {
    const state = game.createInitialState(players, { seed: 7 });
    const actor = game.getCurrentPlayerId(state)!;
    const other = players.find((p) => p !== actor)!;
    expect(game.forfeitTurn!(state, other)).toBeNull();
  });

  it.each(SKIPPABLE)("%s never commits a move on the player's behalf", (_name, game, players) => {
    const state = game.createInitialState(players, { seed: 8 });
    const actor = game.getCurrentPlayerId(state)!;
    const after = game.forfeitTurn!(state, actor)!;

    // Whatever the game tracks as "progress" must be untouched by a forfeit:
    // only whose turn it is may change.
    const strip = (s: unknown) => {
      const clone = JSON.parse(JSON.stringify(s));
      delete clone.currentIndex;
      delete clone.dice;
      delete clone.drawnThisTurn;
      delete clone.consecutiveExtras;
      return JSON.stringify(clone);
    };
    expect(strip(after)).toBe(strip(state));
  });

  it.each(SKIPPABLE)("%s leaves a repeated forfeit cycling, never stuck", (_name, game, players) => {
    let state = game.createInitialState(players, { seed: 9 });
    const seen: string[] = [];
    for (let i = 0; i < players.length * 2; i++) {
      const actor = game.getCurrentPlayerId(state)!;
      seen.push(actor);
      state = game.forfeitTurn!(state, actor)!;
    }
    // Every seat gets a turn rather than the clock parking on one player.
    expect(new Set(seen).size).toBe(players.length);
  });
});

describe("forfeitTurn — games that cannot skip", () => {
  it("Liar's Dice offers no forfeit, because play cannot continue without an action", () => {
    const state = liarsDiceModule.createInitialState(["a", "b", "c"], { seed: 1 });
    const actor = liarsDiceModule.getCurrentPlayerId(state)!;
    // No forfeitTurn at all, or one that declines — either is fine, but there
    // must be a fallback move so the room never deadlocks.
    const forfeited = liarsDiceModule.forfeitTurn?.(state, actor) ?? null;
    expect(forfeited).toBeNull();

    const fallback = liarsDiceModule.getTimeoutMove!(state, actor);
    expect(fallback).not.toBeNull();
    expect(liarsDiceModule.validateMove(state, actor, fallback!)).toBe(true);
  });
});

describe("every module keeps the room unstuck on a timeout", () => {
  const ALL: Array<[string, AnyGameModule, string[]]> = [
    ...SKIPPABLE,
    ["liars-dice", liarsDiceModule, ["a", "b", "c"]],
  ];

  it.each(ALL)("%s can always advance from an expired clock", (_name, game, players) => {
    const state = game.createInitialState(players, { seed: 11 });
    const actor = game.getCurrentPlayerId(state)!;

    const forfeited = game.forfeitTurn?.(state, actor) ?? null;
    if (forfeited !== null) {
      expect(game.getCurrentPlayerId(forfeited)).not.toBe(actor);
      return;
    }
    // Otherwise the fallback move must be legal and must move play along.
    const move = game.getTimeoutMove!(state, actor);
    expect(move).not.toBeNull();
    expect(game.validateMove(state, actor, move)).toBe(true);
    const applied = game.applyMove(state, actor, move).state;
    expect(game.getCurrentPlayerId(applied)).not.toBe(actor);
  });
});
