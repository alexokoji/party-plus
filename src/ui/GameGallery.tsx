"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createRoom as createRoomOnServer, ensureIdentity, getDisplayName, setDisplayName } from "../client/identity";
import { normalizeRoomCode } from "../platform/roomCodes";
import { AccountPanel } from "./AccountPanel";
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

      <h2 className="gallery-heading">Games</h2>
      <div className="game-gallery">
        {games.map((game) => (
          <article key={game.id} className="game-card">
            <h3>{game.name}</h3>
            <p className="game-card-tagline">{game.tagline}</p>
            <p className="game-card-meta">
              {game.minPlayers}–{game.maxPlayers} players
              {game.estimatedMinutes ? ` · ~${game.estimatedMinutes} min` : ""}
              {game.hasHiddenState ? " · hidden info" : ""}
            </p>
            <button type="button" disabled={creating} onClick={() => void createRoom(game.id)}>
              {creating ? "Creating…" : "Create room"}
            </button>
          </article>
        ))}
        <article className="game-card ghost-card">
          <h3>More soon</h3>
          <p className="game-card-tagline">
            The room engine is game-agnostic — new games plug in as modules.
          </p>
        </article>
      </div>
    </>
  );
}
