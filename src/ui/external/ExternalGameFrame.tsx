"use client";

import { useState } from "react";
import type { ExternalGame } from "../../external/types";

export interface ExternalGameFrameProps {
  game: ExternalGame;
}

/**
 * Frames a game somebody else hosts.
 *
 * Three deliberate decisions, all about the fact that this is a stranger's
 * code running under our name:
 *
 * 1. It does not load until the player asks. No third-party script, no ad
 *    call, no tracker runs because someone glanced at a page. It is also why
 *    the gallery stays fast — thirteen tiles do not open thirteen frames.
 * 2. `sandbox` is an allow-list. The frame may run scripts and be
 *    same-origin *to itself*, which most games need to save progress, but it
 *    cannot navigate our page away, open popups, or reach our storage —
 *    different origin, so the browser will not let it near a session token.
 * 3. It says whether the game carries ads BEFORE the click, because ads are
 *    how these titles are free to carry and springing them on someone is how
 *    a site loses trust.
 */
export function ExternalGameFrame({ game }: ExternalGameFrameProps) {
  const [playing, setPlaying] = useState(false);
  const ratio = game.aspectRatio && game.aspectRatio > 0 ? game.aspectRatio : 16 / 9;

  return (
    <div className="external-game">
      <div className="external-stage" style={{ aspectRatio: String(ratio) }}>
        {playing ? (
          <iframe
            className="external-frame"
            src={game.embedUrl}
            title={game.name}
            /**
             * Everything not listed here is denied. Notably absent:
             * allow-top-navigation (it cannot move our page), and
             * allow-modals/allow-popups (it cannot open windows over us).
             */
            sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-orientation-lock"
            allow="autoplay; fullscreen; gamepad"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="external-cover">
            <h2>{game.name}</h2>
            <p>{game.tagline}</p>
            <button type="button" onClick={() => setPlaying(true)}>
              ▶ Play
            </button>
            <p className="external-note">
              Hosted by {providerName(game.provider)}
              {game.hasAds ? " · contains ads" : ""}. It loads only when you press play.
            </p>
          </div>
        )}
      </div>

      {playing && (
        <div className="external-actions">
          <button type="button" className="ghost" onClick={() => setPlaying(false)}>
            Close game
          </button>
          <span className="external-note">
            Hosted by {providerName(game.provider)}
            {game.hasAds ? " · contains ads" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function providerName(provider: ExternalGame["provider"]): string {
  if (provider === "gamedistribution") return "GameDistribution";
  if (provider === "gamepix") return "GamePix";
  return "us";
}
