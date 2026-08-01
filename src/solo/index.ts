import { registerSoloGame } from "./registry";
import { WordHunt } from "./word-hunt/WordHunt";
import { DanfoDash } from "./danfo-dash/DanfoDash";

/**
 * Single import site for every solo game.
 *
 * Registration lives HERE rather than beside each component, and that is not a
 * style choice. A file marked "use client" is replaced by a client reference
 * when a server component imports it — its module body never runs on the
 * server, so a `registerSoloGame(...)` call inside one registers nothing during
 * a server render, and the gallery comes back empty with no error anywhere.
 * This file has no "use client", so it runs in both places, which is what the
 * registry needs.
 *
 * Plugging a game in is therefore: write it, and add it below.
 */
let registered = false;

export function registerSoloGames(): void {
  if (registered) return;
  registered = true;

  registerSoloGame({
    meta: {
      id: "word-hunt",
      name: "Word Hunt",
      tagline: "Six guesses, five letters. Play it in English, Naija or Pidgin.",
      category: "puzzle",
      estimatedMinutes: 3,
    },
    Component: WordHunt,
  });

  registerSoloGame({
    meta: {
      id: "danfo-dash",
      name: "Danfo Dash",
      tagline: "Lagos traffic at speed. One lane change from disaster.",
      category: "arcade",
      estimatedMinutes: 2,
    },
    Component: DanfoDash,
  });
}

registerSoloGames();

export { getSoloGame, listSoloGames, registerSoloGame } from "./registry";
export { toGalleryMeta, type SoloGame, type SoloGameMeta } from "./types";
