import { registerPacks } from "./store";
import wordsGeneral from "./packs/words-general.json";
import wordsNaija from "./packs/words-naija.json";
import wordsPidgin from "./packs/words-pidgin.json";
import drawGeneral from "./packs/draw-general.json";
import drawNaija from "./packs/draw-naija.json";
import triviaGeneral from "./packs/trivia-general.json";
import triviaNaija from "./packs/trivia-naija.json";

/**
 * Bundled content.
 *
 * These are the floor, not the ceiling: they guarantee every game can start
 * even with no data store configured. Anything loaded later from the store
 * (see remote.ts) is layered on top and may replace a bundled pack by id.
 */
export const BUNDLED: unknown[] = [
  wordsGeneral,
  wordsNaija,
  wordsPidgin,
  drawGeneral,
  drawNaija,
  triviaGeneral,
  triviaNaija,
];

let loaded = false;

export function loadBundledPacks({ force = false } = {}): void {
  if (loaded && !force) return;
  loaded = true;
  const { errors } = registerPacks(BUNDLED);
  // A bundled pack that fails validation is a build-time mistake, not a
  // content problem — fail loudly rather than shipping a half-empty picker.
  if (errors.length) throw new Error(`bundled content packs are invalid:\n${errors.join("\n")}`);
}

loadBundledPacks();

export * from "./types";
export * from "./store";
