import Link from "next/link";
import { GameGallery } from "../src/ui/GameGallery";
import { listGames } from "../src/platform/registry";
import "../src/games/index"; // side effect: registers room games
import "../src/solo/index"; // side effect: registers solo games
import { listSoloGames } from "../src/solo/index";
import { toGalleryMeta } from "../src/solo/types";
import "../src/external/catalogue"; // side effect: loads third-party games
import { listExternalGames } from "../src/external/registry";
import { toGalleryMeta as externalToGalleryMeta } from "../src/external/types";

export default function HomePage() {
  // Both catalogues, one gallery. A solo puzzle and a twelve-player party game
  // are the same thing to someone browsing; only the way they start differs.
  const games = [
    ...listGames(),
    ...listSoloGames().map(toGalleryMeta),
    ...listExternalGames().map(externalToGalleryMeta),
  ];

  return (
    <main>
      <h1>Games Dome</h1>
      <p style={{ fontSize: "1.15rem", maxWidth: "38rem" }}>
        A room, a code, and your friends. Pick a game, ready up, and play — with chat, emotes and
        spectators built in.
      </p>

      <GameGallery games={games} />

      <div className="link-row">
        <Link href="/library">🎨 Your library</Link>
        <Link href="/room/demo">🤖 Practise Liar&apos;s Dice against bots</Link>
        <Link href="/match/demo/results">📊 Sample post-match report</Link>
      </div>
    </main>
  );
}
