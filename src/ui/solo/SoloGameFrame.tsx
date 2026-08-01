"use client";

import { getSoloGame } from "../../solo/index";

export interface SoloGameFrameProps {
  gameId: string;
}

/**
 * Renders a solo game from the registry, on the client.
 *
 * The lookup happens here rather than in the page for a reason: the page is a
 * server component, and pulling a component out of a Map at request time and
 * rendering it makes the server/client boundary depend on registry order
 * instead of on imports. Doing it in a client component keeps the boundary
 * exactly where "use client" says it is, and the registry stays the single
 * place a game plugs in.
 */
export function SoloGameFrame({ gameId }: SoloGameFrameProps) {
  const game = getSoloGame(gameId);
  if (!game) return <p className="hint">That game is not available.</p>;
  const Game = game.Component;
  return <Game />;
}
