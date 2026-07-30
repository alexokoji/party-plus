import type { AnyGameModule, GameMeta } from "./types";

const modules = new Map<string, AnyGameModule>();

export class ModuleRegistrationError extends Error {}

/**
 * Registers a game module.
 *
 * The checks here are deliberately strict: a module with a broken player
 * range or a missing getPlayerView would fail at runtime inside a live room,
 * where the failure mode for a redaction bug is leaking hidden state to every
 * player. Better to refuse it at import time.
 */
export function registerGame(module: AnyGameModule): void {
  const { meta } = module;
  if (!meta?.id) throw new ModuleRegistrationError("game module needs a meta.id");
  if (modules.has(meta.id)) {
    throw new ModuleRegistrationError(`duplicate game module id: ${meta.id}`);
  }
  if (meta.minPlayers < 1 || meta.maxPlayers < meta.minPlayers) {
    throw new ModuleRegistrationError(
      `${meta.id}: invalid player range ${meta.minPlayers}-${meta.maxPlayers}`
    );
  }
  for (const fn of [
    "createInitialState",
    "validateMove",
    "applyMove",
    "getPlayerView",
    "checkWinCondition",
    "getCurrentPlayerId",
  ] as const) {
    if (typeof module[fn] !== "function") {
      throw new ModuleRegistrationError(`${meta.id}: missing ${fn}()`);
    }
  }
  modules.set(meta.id, module);
}

export function getGame(id: string): AnyGameModule | null {
  return modules.get(id) ?? null;
}

/** Throws rather than returning null, for call sites that cannot proceed. */
export function requireGame(id: string): AnyGameModule {
  const module = modules.get(id);
  if (!module) throw new ModuleRegistrationError(`unknown game module: ${id}`);
  return module;
}

export function listGames(): GameMeta[] {
  return [...modules.values()].map((m) => m.meta);
}

/** Test-only: drop all registrations so suites don't leak into each other. */
export function resetRegistry(): void {
  modules.clear();
}
