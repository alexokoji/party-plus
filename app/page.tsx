import Link from "next/link";
import { GameGallery } from "../src/ui/GameGallery";
import { listGames } from "../src/platform/registry";
import "../src/games/index"; // side effect: registers built-in games

export default function HomePage() {
  const games = listGames();

  return (
    <main>
      <h1>Party Plus</h1>
      <p style={{ fontSize: "1.15rem", maxWidth: "38rem" }}>
        A room, a code, and your friends. Pick a game, ready up, and play — with chat, emotes and
        spectators built in.
      </p>

      <GameGallery games={games} />

      <div className="link-row">
        <Link href="/room/demo">🤖 Practise Liar&apos;s Dice against bots</Link>
        <Link href="/match/demo/results">📊 Sample post-match report</Link>
      </div>
    </main>
  );
}
