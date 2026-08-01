import type { GameCategory, GameMeta } from "../platform/types";

/**
 * Games somebody else made and hosts.
 *
 * A distributor (GameDistribution, GamePix and friends) licenses a catalogue
 * of HTML5 games and pays a share of the ad revenue they earn inside them.
 * That is how a platform carries hundreds of titles without writing hundreds
 * of games — and it is a genuinely different shape from the other two kinds
 * here, because we do not own the code, cannot see its state, and must not
 * give it access to ours.
 *
 * So an external game is DATA, not code: a name, a category, and a URL to
 * frame. Adding one is a line in the catalogue.
 */

export type GameProvider = "gamedistribution" | "gamepix" | "self-hosted";

export interface ExternalGame {
  id: string;
  name: string;
  tagline: string;
  category: GameCategory;
  provider: GameProvider;
  /** The provider's embed URL. Must be https. */
  embedUrl: string;
  /** Width / height. Most HTML5 games are 16:9; some portrait ones are 9:16. */
  aspectRatio?: number;
  estimatedMinutes?: number;
  /**
   * True when the provider shows ads inside the frame.
   *
   * Recorded so the UI can say so before someone clicks into it. Ads are the
   * provider's business model and the reason the game is free to carry, but
   * springing them on a player unannounced is how a site loses trust.
   */
  hasAds?: boolean;
}

/**
 * Hosts we are willing to frame.
 *
 * An allow-list rather than "any https URL" because an embed runs somebody
 * else's code in front of our users under our name. A typo, a bad paste or a
 * compromised catalogue entry should fail closed, not quietly ship a stranger's
 * page to every visitor.
 */
export const ALLOWED_EMBED_HOSTS = [
  "html5.gamedistribution.com",
  "gamedistribution.com",
  "html5.gamepix.com",
  "games.gamepix.com",
] as const;

/** The gallery shape, so external games list beside the rest. */
export function toGalleryMeta(game: ExternalGame): GameMeta {
  return {
    id: game.id,
    name: game.name,
    tagline: game.tagline,
    category: game.category,
    minPlayers: 1,
    maxPlayers: 1,
    hasHiddenState: false,
    modes: ["solo"],
    estimatedMinutes: game.estimatedMinutes,
  };
}
