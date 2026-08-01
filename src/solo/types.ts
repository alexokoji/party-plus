import type { ComponentType } from "react";
import type { GameCategory, GameMeta } from "../platform/types";

/**
 * Games that need no server.
 *
 * `GameModule` is built around a problem solo games do not have: authoritative
 * state on a server, redacted per player, moved by validated messages. A
 * puzzle or an arcade game has no opponent to hide anything from and nothing
 * to arbitrate, so forcing one through that contract would mean a Durable
 * Object, a socket and a per-player view for a single player alone in a
 * browser — cost and latency bought for nothing.
 *
 * So this is a second, much smaller contract: metadata for the gallery, and a
 * component. Everything runs on the device. That is what makes these free to
 * serve, instant to start, and playable with no account.
 */

export interface SoloGameMeta extends Omit<GameMeta, "minPlayers" | "maxPlayers" | "hasHiddenState"> {
  category: GameCategory;
  /** Rough minutes for one attempt. */
  estimatedMinutes?: number;
}

export interface SoloGame {
  meta: SoloGameMeta;
  /** Rendered at /play/<id>. Owns its own state; the platform holds none. */
  Component: ComponentType;
}

/** The shape the gallery consumes, so solo and room games list side by side. */
export function toGalleryMeta(game: SoloGame): GameMeta {
  return {
    ...game.meta,
    minPlayers: 1,
    maxPlayers: 1,
    hasHiddenState: false,
    modes: ["solo"],
  };
}
