import type { SoloGame } from "./types";

/**
 * The solo catalogue.
 *
 * Mirrors the module registry deliberately — same shape, same guarantees — so
 * that "plug a game in" means the same thing whichever kind it is: write it,
 * register it, and it appears. Nothing else changes.
 */
const games = new Map<string, SoloGame>();

export class SoloRegistryError extends Error {}

export function registerSoloGame(game: SoloGame): void {
  const { id, name, category } = game.meta ?? {};
  if (!id) throw new SoloRegistryError("a solo game needs an id");
  if (!name) throw new SoloRegistryError(`solo game ${id}: needs a name`);
  if (!category) throw new SoloRegistryError(`solo game ${id}: needs a category`);
  if (!game.Component) throw new SoloRegistryError(`solo game ${id}: needs a component`);
  // Loud rather than silently shadowing: two games under one id would make
  // whichever loaded second invisible, with no error anywhere.
  if (games.has(id)) throw new SoloRegistryError(`solo game ${id} is already registered`);
  games.set(id, game);
}

export function getSoloGame(id: string): SoloGame | null {
  return games.get(id) ?? null;
}

export function listSoloGames(): SoloGame[] {
  return [...games.values()];
}

/** Test seam. */
export function clearSoloGames(): void {
  games.clear();
}
