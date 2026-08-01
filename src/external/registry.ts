import { ALLOWED_EMBED_HOSTS, type ExternalGame } from "./types";

/**
 * The external catalogue.
 *
 * Every entry is validated on the way in. That matters more here than for our
 * own games: an embed URL decides whose code runs in front of our users, so a
 * bad one is not a broken tile, it is a stranger's page served under our name.
 * Validation fails closed and says why.
 */
const games = new Map<string, ExternalGame>();

export class ExternalGameError extends Error {}

export function validateExternalGame(game: ExternalGame): ExternalGame {
  if (!game?.id) throw new ExternalGameError("an external game needs an id");
  if (!game.name) throw new ExternalGameError(`external game ${game.id}: needs a name`);
  if (!game.category) throw new ExternalGameError(`external game ${game.id}: needs a category`);

  let url: URL;
  try {
    url = new URL(game.embedUrl);
  } catch {
    throw new ExternalGameError(`external game ${game.id}: embedUrl is not a URL`);
  }

  // http would let anyone on the network rewrite the game on its way to the
  // player, inside a frame carrying our name.
  if (url.protocol !== "https:") {
    throw new ExternalGameError(`external game ${game.id}: embedUrl must be https`);
  }
  if (!(ALLOWED_EMBED_HOSTS as readonly string[]).includes(url.hostname)) {
    throw new ExternalGameError(
      `external game ${game.id}: ${url.hostname} is not an allowed embed host. ` +
        `Add it to ALLOWED_EMBED_HOSTS only if you actually trust it with your users.`
    );
  }

  return game;
}

export function registerExternalGame(game: ExternalGame): void {
  const valid = validateExternalGame(game);
  if (games.has(valid.id)) {
    throw new ExternalGameError(`external game ${valid.id} is already registered`);
  }
  games.set(valid.id, valid);
}

/** Loads a batch, keeping the good ones and reporting the rest. */
export function registerExternalGames(entries: ExternalGame[]): { loaded: string[]; errors: string[] } {
  const loaded: string[] = [];
  const errors: string[] = [];
  for (const entry of entries) {
    try {
      registerExternalGame(entry);
      loaded.push(entry.id);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { loaded, errors };
}

export function getExternalGame(id: string): ExternalGame | null {
  return games.get(id) ?? null;
}

export function listExternalGames(): ExternalGame[] {
  return [...games.values()];
}

/** Test seam. */
export function clearExternalGames(): void {
  games.clear();
}
