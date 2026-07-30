"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getDisplayName, setDisplayName } from "../client/deviceId";
import type { GameMeta } from "../platform/types";

/** Ambiguous characters (0/O, 1/I) are omitted so codes survive being read aloud. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

export function generateRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

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

  useEffect(() => setName(getDisplayName()), []);

  function saveName(value: string) {
    setName(value);
    setDisplayName(value);
  }

  function createRoom(gameId?: string) {
    const room = generateRoomCode();
    router.push(gameId ? `/online/${room}?game=${gameId}` : `/online/${room}`);
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
          <button type="button" onClick={() => createRoom()}>
            🎲 Create a room
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
      </div>

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
            <button type="button" onClick={() => createRoom(game.id)}>
              Create room
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
