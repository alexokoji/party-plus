import Link from "next/link";
import { notFound } from "next/navigation";
import "../../../src/games/index"; // side effect: registers built-in games
import { getGame } from "../../../src/platform/registry";
import { SoloLiarsDice } from "../../../src/ui/solo/SoloLiarsDice";

/**
 * Playing alone.
 *
 * Solo runs entirely in the browser: no room, no Durable Object, no account,
 * no socket. That makes it free to serve and instant to start, which is why it
 * is the front door of the platform rather than an afterthought — someone
 * arriving from a search result can be playing before they decide whether they
 * trust us with an email address.
 *
 * A game opts in by listing "solo" in its modes; anything else 404s rather
 * than offering a mode it cannot deliver.
 */
export default async function SoloPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const game = getGame(gameId);
  if (!game || !(game.meta.modes ?? ["room"]).includes("solo")) notFound();

  return (
    <main>
      <div className="room-head">
        <h1>{game.meta.name}</h1>
        <Link href="/">← All games</Link>
      </div>
      <p className="solo-blurb">{game.meta.tagline}</p>

      {gameId === "liars-dice" && <SoloLiarsDice />}
    </main>
  );
}
