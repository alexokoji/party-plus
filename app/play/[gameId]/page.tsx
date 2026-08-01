import Link from "next/link";
import { notFound } from "next/navigation";
import "../../../src/games/index"; // side effect: registers room games
import "../../../src/solo/index"; // side effect: registers solo games
import { getGame } from "../../../src/platform/registry";
import { getSoloGame } from "../../../src/solo/registry";
import "../../../src/external/catalogue"; // side effect: loads third-party games
import { getExternalGame } from "../../../src/external/registry";
import { ExternalGameFrame } from "../../../src/ui/external/ExternalGameFrame";
import { SoloGameFrame } from "../../../src/ui/solo/SoloGameFrame";
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
 * Two kinds of game land here. A room game that lists "solo" in its modes gets
 * bots for opponents; a solo-only game (puzzle, arcade) brings its own
 * component and needs no server at all.
 */
export default async function SoloPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  const solo = getSoloGame(gameId);
  const external = getExternalGame(gameId);
  const room = getGame(gameId);
  const meta = solo?.meta ?? external ?? room?.meta;

  // Anything that cannot actually be played alone 404s rather than offering a
  // mode it cannot deliver.
  if (!meta) notFound();
  if (!solo && !external && !(room?.meta.modes ?? ["room"]).includes("solo")) notFound();

  return (
    <main>
      <div className="room-head">
        <h1>{meta.name}</h1>
        <Link href="/">← All games</Link>
      </div>
      <p className="solo-blurb">{meta.tagline}</p>

      {solo ? (
        <SoloGameFrame gameId={gameId} />
      ) : external ? (
        <ExternalGameFrame game={external} />
      ) : gameId === "liars-dice" ? (
        <SoloLiarsDice />
      ) : null}
    </main>
  );
}
