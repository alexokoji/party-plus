"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createRoom as createRoomOnServer, ensureIdentity, getDisplayName, setDisplayName } from "../client/identity";
import { normalizeRoomCode } from "../platform/roomCodes";
import { AccountPanel } from "./AccountPanel";
import Link from "next/link";
import { GameArt } from "./GameArt";
import type { GameCategory } from "../platform/types";

/** Shelf order, and how each one is introduced. */
const CATEGORY_ORDER: GameCategory[] = ["party", "board", "card", "puzzle", "arcade"];

const CATEGORY_LABEL: Record<GameCategory, string> = {
  party: "Party games",
  board: "Board games",
  card: "Card games",
  puzzle: "Puzzles",
  arcade: "Arcade",
};

const CATEGORY_BLURB: Record<GameCategory, string> = {
  party: "Loud, social, and best with a room full of people.",
  board: "The classics, with proper rules and a server that enforces them.",
  card: "Shuffle, deal, and keep your hand to yourself.",
  puzzle: "Think it through. Alone or against the clock.",
  arcade: "Quick reflexes, quick rounds.",
};
import type { GameMeta } from "../platform/types";

export { normalizeRoomCode };

export interface GameGalleryProps {
  games: GameMeta[];
}

/**
 * Hub: the game gallery plus create/join.
 *
 * Games come from the module registry, so a newly registered game appears
 * here with no change to this component.
 */
export function GameGallery({ games }: GameGalleryProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(getDisplayName()), []);

  // Grouped once per render of the catalogue rather than per shelf.
  const grouped = useMemo(() => {
    const map = new Map<GameCategory, GameMeta[]>();
    for (const game of games) {
      const category = game.category ?? "party";
      map.set(category, [...(map.get(category) ?? []), game]);
    }
    return map;
  }, [games]);

  function saveName(value: string) {
    setName(value);
    setDisplayName(value);
  }

  /**
   * Rooms are minted by the server now.
   *
   * A code generated here could only ever be as unguessable as Math.random,
   * and worse, the old flow meant any code someone typed brought a room into
   * existence — so a wrong guess was indistinguishable from a right one.
   */
  async function createRoom(gameId?: string) {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const { token } = await ensureIdentity();
      const room = await createRoomOnServer(token);
      router.push(gameId ? `/online/${room}?game=${gameId}` : `/online/${room}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a room.");
      setCreating(false);
    }
  }

  function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (normalized) router.push(`/online/${normalized}`);
  }

  return (
    <>
      <div className="card-panel launcher">
        <label className="name-field">
          <span>Your name</span>
          <input value={name} maxLength={16} placeholder="Pick a name" onChange={(e) => saveName(e.target.value)} />
        </label>

        <div className="launcher-actions">
          <button type="button" disabled={creating} onClick={() => void createRoom()}>
            {creating ? "Creating…" : "🎲 Create a room"}
          </button>
          <form className="join-form" onSubmit={joinRoom}>
            <input
              value={code}
              placeholder="Room code"
              aria-label="Room code"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button type="submit" disabled={!normalizeRoomCode(code)}>
              Join
            </button>
          </form>
        </div>
        <p className="launcher-hint">Create a room and share the link, or type a friend&apos;s code.</p>
        {error && <p className="error-note">{error}</p>}
      </div>

      <AccountPanel onName={setName} />

      {/* Shelves come from the games themselves, so adding a category — or a
          game in a new one — needs no change here. */}
      {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => (
        <section key={category} className="gallery-section">
          <h2 className="gallery-heading">{CATEGORY_LABEL[category]}</h2>
          <p className="gallery-blurb">{CATEGORY_BLURB[category]}</p>
          <div className="game-gallery">
            {(grouped.get(category) ?? []).map((game) => {
              const solo = (game.modes ?? ["room"]).includes("solo");
              return (
                <article key={game.id} className="game-card">
                  <GameArt gameId={game.id} />
                  <h3>{game.name}</h3>
                  <p className="game-card-tagline">{game.tagline}</p>
                  <p className="game-card-meta">
                    {game.minPlayers}–{game.maxPlayers} players
                    {game.estimatedMinutes ? ` · ~${game.estimatedMinutes} min` : ""}
                    {game.hasHiddenState ? " · hidden info" : ""}
                  </p>
                  <div className="game-card-actions">
                    {/* Solo needs no room, no server and no account — so it is
                        offered first, as the way in that costs nothing. */}
                    {solo && (
                      <Link className="play-solo" href={`/play/${game.id}`}>
                        Play solo
                      </Link>
                    )}
                    <button type="button" disabled={creating} onClick={() => void createRoom(game.id)}>
                      {creating ? "Creating…" : solo ? "With friends" : "Create room"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
