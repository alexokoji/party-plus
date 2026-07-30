"use client";

import type { GameMeta } from "../platform/types";
import type { RoomSnapshot } from "../platform/roomTypes";

export interface RoomLobbyProps {
  snapshot: RoomSnapshot;
  playerId: string;
  isHost: boolean;
  onSelectGame: (gameId: string) => void;
  onSetGameOptions: (options: Record<string, unknown>) => void;
  onReady: (ready: boolean) => void;
  onSpectate: (spectate: boolean) => void;
  onStart: () => void;
  /** Host only: close the room to new players. */
  onLock: (locked: boolean) => void;
  /** Host only: remove someone and keep them out. */
  onKick: (playerId: string) => void;
}

/** Pre-match lobby: pick a game, take a seat or spectate, ready up. */
export function RoomLobby({
  snapshot,
  playerId,
  isHost,
  onSelectGame,
  onSetGameOptions,
  onReady,
  onSpectate,
  onStart,
  onLock,
  onKick,
}: RoomLobbyProps) {
  const me = snapshot.members.find((m) => m.id === playerId);
  const seated = snapshot.members.filter((m) => m.seated);
  const spectators = snapshot.members.filter((m) => !m.seated);
  const game: GameMeta | null = snapshot.gameMeta;

  const enoughPlayers = !!game && seated.length >= game.minPlayers && seated.length <= game.maxPlayers;
  const allReady = seated.length > 0 && seated.every((m) => m.ready);

  return (
    <div className="lobby">
      <section className="card-panel">
        <h2>Choose a game</h2>
        <div className="game-picker">
          {snapshot.catalog.map((meta) => {
            const selected = snapshot.gameId === meta.id;
            return (
              <button
                key={meta.id}
                type="button"
                className={`game-option${selected ? " selected" : ""}`}
                disabled={!isHost}
                onClick={() => onSelectGame(meta.id)}
              >
                <span className="game-option-name">{meta.name}</span>
                <span className="game-option-meta">
                  {meta.minPlayers}–{meta.maxPlayers} players
                  {meta.estimatedMinutes ? ` · ~${meta.estimatedMinutes} min` : ""}
                </span>
                <span className="game-option-tagline">{meta.tagline}</span>
              </button>
            );
          })}
        </div>
        {!isHost && <p className="hint">The host picks the game.</p>}

        {/* Games with regional or house variants advertise them in their meta,
            so this picker is generic — no game is named here. */}
        {game?.variants && game.variants.length > 1 && (
          <div className="variant-picker">
            <h3>Rules</h3>
            {game.variants.map((variant) => {
              const key = game.variantOptionKey ?? "variant";
              const current = (snapshot.gameOptions?.[key] as string) ?? game.variants![0]!.id;
              return (
                <label key={variant.id} className={`variant-option${current === variant.id ? " selected" : ""}`}>
                  <input
                    type="radio"
                    name="variant"
                    checked={current === variant.id}
                    disabled={!isHost}
                    onChange={() => onSetGameOptions({ [key]: variant.id })}
                  />
                  <span>
                    <strong>{variant.name}</strong>
                    <span className="variant-desc">{variant.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {/* Anything else the game offers — content packs, mostly. Resolved by
            the server per snapshot, so a pack added to the content store while
            this lobby is open appears here without a reload. */}
        {(snapshot.optionGroups ?? []).map((group) => {
          const current = (snapshot.gameOptions?.[group.key] as string) ?? group.options[0]?.id;
          if (group.options.length < 2) return null;
          return (
            <div className="variant-picker" key={group.key}>
              <h3>{group.name}</h3>
              {group.description && <p className="hint">{group.description}</p>}
              {group.options.map((option) => (
                <label
                  key={option.id}
                  className={`variant-option${current === option.id ? " selected" : ""}`}
                >
                  <input
                    type="radio"
                    name={group.key}
                    checked={current === option.id}
                    disabled={!isHost}
                    onChange={() => onSetGameOptions({ [group.key]: option.id })}
                  />
                  <span>
                    <strong>{option.name}</strong>
                    <span className="variant-desc">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          );
        })}
      </section>

      <section className="card-panel">
        <h2>Players {game ? `(${seated.length}/${game.maxPlayers})` : ""}</h2>
        <ul className="member-list">
          {seated.map((m) => (
            <li key={m.id} className={m.ready ? "ready" : ""}>
              <span>
                {m.name}
                {snapshot.hostId === m.id ? " ★" : ""}
                {m.id === playerId ? " (you)" : ""}
                {isHost && m.id !== playerId && (
                  <button
                    type="button"
                    className="kick-button"
                    title={`Remove ${m.name}`}
                    onClick={() => onKick(m.id)}
                  >
                    ✕
                  </button>
                )}
              </span>
              <span className="member-status">
                {!m.connected ? "offline" : m.ready ? "✓ ready" : "not ready"}
              </span>
            </li>
          ))}
        </ul>

        {spectators.length > 0 && (
          <>
            <h3>Spectators</h3>
            <ul className="member-list muted">
              {spectators.map((m) => (
                <li key={m.id}>
                  <span>
                    {m.name}
                    {m.id === playerId ? " (you)" : ""}
                  </span>
                  <span className="member-status">👀 watching</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="lobby-actions">
          {me?.seated ? (
            <>
              <button type="button" onClick={() => onReady(!me.ready)}>
                {me.ready ? "Not ready" : "I'm ready"}
              </button>
              <button type="button" className="ghost" onClick={() => onSpectate(true)}>
                👀 Spectate instead
              </button>
            </>
          ) : (
            <button type="button" onClick={() => onSpectate(false)}>
              Take a seat
            </button>
          )}

          {isHost && (
            <button type="button" onClick={onStart} disabled={!enoughPlayers || !allReady}>
              Start match
            </button>
          )}

          {isHost && (
            <button type="button" className="ghost" onClick={() => onLock(!snapshot.locked)}>
              {snapshot.locked ? "🔓 Unlock room" : "🔒 Lock room"}
            </button>
          )}
        </div>

        {snapshot.locked && (
          <p className="hint">
            🔒 Locked — nobody new can join. People already here can still reconnect.
          </p>
        )}

        {isHost && !game && <p className="hint">Pick a game above to start.</p>}
        {isHost && game && !enoughPlayers && (
          <p className="hint">
            {game.name} needs {game.minPlayers}–{game.maxPlayers} seated players.
          </p>
        )}
        {isHost && enoughPlayers && !allReady && <p className="hint">Waiting for everyone to ready up.</p>}
        {!isHost && <p className="hint">Waiting for the host to start.</p>}
      </section>
    </div>
  );
}
