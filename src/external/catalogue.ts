import { registerExternalGames } from "./registry";
import type { ExternalGame } from "./types";

/**
 * Third-party games carried on Games Dome.
 *
 * THIS LIST IS EMPTY ON PURPOSE.
 *
 * Every entry here embeds a game somebody else owns and hosts, under a revenue
 * agreement between you and that provider. Shipping entries before the account
 * exists would mean framing content nobody has licensed, which is exactly the
 * problem this route is supposed to avoid — so the mechanism is built and the
 * catalogue waits for you.
 *
 * To add one:
 *
 *   1. Open an account with a distributor. The two the loader already trusts:
 *      · GameDistribution — https://gamedistribution.com (publisher signup)
 *      · GamePix          — https://www.gamepix.com/publishers
 *      Both licence HTML5 catalogues to sites and share the ad revenue earned
 *      inside the frame. Read their terms yourself: the split, the payout
 *      threshold and the ad behaviour are theirs to set and they change.
 *
 *   2. Pick a game in their dashboard and copy its embed URL.
 *
 *   3. Add an entry below. The host must be on ALLOWED_EMBED_HOSTS in
 *      types.ts, which is what stops a bad paste from shipping.
 *
 * An example, commented out because it is not licensed to anyone:
 *
 *   {
 *     id: "example-runner",
 *     name: "Example Runner",
 *     tagline: "A platformer somebody else built and hosts.",
 *     category: "arcade",
 *     provider: "gamedistribution",
 *     embedUrl: "https://html5.gamedistribution.com/<their-game-id>/",
 *     aspectRatio: 16 / 9,
 *     hasAds: true,
 *     estimatedMinutes: 5,
 *   },
 *
 * A note on the genre you asked about: platformers of the Level Devil sort are
 * exactly what these catalogues carry, but that specific title belongs to its
 * studio. Carry it only if it appears in a distributor's catalogue, or licence
 * it from them directly. The alternative is building originals, which is what
 * Danfo Dash is.
 */
export const EXTERNAL_GAMES: ExternalGame[] = [];

let loaded = false;

export function loadExternalGames(): { loaded: string[]; errors: string[] } {
  if (loaded) return { loaded: [], errors: [] };
  loaded = true;
  const result = registerExternalGames(EXTERNAL_GAMES);
  // A rejected entry is a configuration mistake worth seeing in the logs
  // rather than a tile that silently never appears.
  if (result.errors.length) {
    console.warn(`[external-games] ${result.errors.length} entr(ies) rejected:\n${result.errors.join("\n")}`);
  }
  return result;
}

loadExternalGames();
