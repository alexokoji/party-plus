import { describe, it, expect, beforeEach } from "vitest";
import {
  getGame,
  listGames,
  ModuleRegistrationError,
  registerGame,
  requireGame,
  resetRegistry,
} from "./registry";
import type { AnyGameModule } from "./types";

function stubModule(over: Partial<AnyGameModule["meta"]> = {}): AnyGameModule {
  return {
    meta: {
      id: "stub",
      name: "Stub",
      tagline: "a test game",
      minPlayers: 2,
      maxPlayers: 4,
      hasHiddenState: false,
      ...over,
    },
    createInitialState: () => ({}),
    validateMove: () => true,
    applyMove: (state) => ({ state, events: [] }),
    getPlayerView: (state) => state,
    checkWinCondition: () => null,
    getCurrentPlayerId: () => null,
  };
}

describe("module registry", () => {
  beforeEach(() => resetRegistry());

  it("registers and looks a game up by id", () => {
    registerGame(stubModule());
    expect(getGame("stub")?.meta.name).toBe("Stub");
    expect(listGames().map((m) => m.id)).toEqual(["stub"]);
  });

  it("returns null for an unknown game and throws when one is required", () => {
    expect(getGame("nope")).toBeNull();
    expect(() => requireGame("nope")).toThrow(ModuleRegistrationError);
  });

  it("refuses a duplicate id rather than silently shadowing a game", () => {
    registerGame(stubModule());
    expect(() => registerGame(stubModule())).toThrow(/duplicate/i);
  });

  it("rejects an impossible player range", () => {
    expect(() => registerGame(stubModule({ id: "a", minPlayers: 0 }))).toThrow(/player range/i);
    expect(() => registerGame(stubModule({ id: "b", minPlayers: 5, maxPlayers: 2 }))).toThrow(
      /player range/i
    );
  });

  it("rejects a module missing a required method", () => {
    // A missing getPlayerView is the dangerous case: the room engine would
    // have nothing to redact with.
    const broken = stubModule({ id: "broken" }) as Partial<AnyGameModule>;
    delete broken.getPlayerView;
    expect(() => registerGame(broken as AnyGameModule)).toThrow(/getPlayerView/);
  });

  it("rejects a module with no id", () => {
    const anon = stubModule();
    (anon.meta as { id?: string }).id = "";
    expect(() => registerGame(anon)).toThrow(/meta\.id/);
  });
});

describe("built-in games", () => {
  it("registers Liar's Dice through the shared entry point", async () => {
    resetRegistry();
    const { registerBuiltInGames } = await import("../games/index");
    // The module self-registers on import; call again to prove it is idempotent
    // in effect (the guard prevents a duplicate-id throw).
    registerBuiltInGames();
    expect(getGame("liars-dice")).not.toBeNull();
  });
});
