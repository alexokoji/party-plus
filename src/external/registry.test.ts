import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  clearExternalGames,
  ExternalGameError,
  getExternalGame,
  listExternalGames,
  registerExternalGame,
  registerExternalGames,
  validateExternalGame,
} from "./registry";
import { ALLOWED_EMBED_HOSTS, toGalleryMeta, type ExternalGame } from "./types";

const game = (over: Partial<ExternalGame> = {}): ExternalGame => ({
  id: "runner",
  name: "Runner",
  tagline: "A game somebody else hosts.",
  category: "arcade",
  provider: "gamedistribution",
  embedUrl: "https://html5.gamedistribution.com/abc123/",
  ...over,
});

describe("what may be embedded", () => {
  beforeEach(() => clearExternalGames());

  it("accepts a game from a trusted host", () => {
    expect(validateExternalGame(game())).toMatchObject({ id: "runner" });
  });

  /**
   * The important one. An embed URL decides whose code runs in front of our
   * users under our name, so a typo or a bad paste must fail closed.
   */
  it("refuses a host that is not on the allow-list", () => {
    expect(() => validateExternalGame(game({ embedUrl: "https://evil.example/game/" }))).toThrow(
      /not an allowed embed host/
    );
  });

  it("refuses a lookalike host", () => {
    expect(() =>
      validateExternalGame(game({ embedUrl: "https://html5.gamedistribution.com.evil.example/x/" }))
    ).toThrow(ExternalGameError);
  });

  it("refuses http, which anyone on the network could rewrite", () => {
    expect(() =>
      validateExternalGame(game({ embedUrl: "http://html5.gamedistribution.com/abc/" }))
    ).toThrow(/https/);
  });

  it("refuses javascript: and data: URLs outright", () => {
    for (const embedUrl of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"]) {
      expect(() => validateExternalGame(game({ embedUrl })), embedUrl).toThrow(ExternalGameError);
    }
  });

  it("refuses nonsense that is not a URL at all", () => {
    expect(() => validateExternalGame(game({ embedUrl: "not a url" }))).toThrow(/not a URL/);
  });

  it("insists on the fields the gallery needs", () => {
    expect(() => validateExternalGame(game({ id: "" }))).toThrow(/id/);
    expect(() => validateExternalGame(game({ name: "" }))).toThrow(/name/);
    expect(() => validateExternalGame(game({ category: undefined as never }))).toThrow(/category/);
  });
});

describe("the catalogue", () => {
  beforeEach(() => clearExternalGames());

  it("registers and finds a game", () => {
    registerExternalGame(game());
    expect(getExternalGame("runner")?.name).toBe("Runner");
    expect(listExternalGames()).toHaveLength(1);
  });

  it("refuses to shadow an existing id", () => {
    registerExternalGame(game());
    expect(() => registerExternalGame(game({ name: "Different" }))).toThrow(/already registered/);
  });

  it("keeps the good entries from a bad batch and reports the rest", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = registerExternalGames([
      game(),
      game({ id: "bad", embedUrl: "https://evil.example/x/" }),
      game({ id: "second", embedUrl: "https://html5.gamepix.com/play/xyz" }),
    ]);
    expect(result.loaded).toEqual(["runner", "second"]);
    expect(result.errors).toHaveLength(1);
  });

  it("ships with nothing embedded until somebody licenses something", async () => {
    // Carrying a third party's game before an agreement exists is the exact
    // problem this route is meant to avoid.
    const { EXTERNAL_GAMES } = await import("./catalogue");
    expect(EXTERNAL_GAMES).toEqual([]);
  });

  it("only trusts hosts belonging to real distributors", () => {
    for (const host of ALLOWED_EMBED_HOSTS) {
      expect(host).toMatch(/gamedistribution\.com$|gamepix\.com$/);
    }
  });
});

describe("listing", () => {
  it("presents an external game like any other, and solo-only", () => {
    const meta = toGalleryMeta(game());
    expect(meta).toMatchObject({ id: "runner", category: "arcade", modes: ["solo"] });
    expect(meta.minPlayers).toBe(1);
    expect(meta.hasHiddenState).toBe(false);
  });
});
