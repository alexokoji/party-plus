"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRoom } from "../../../src/client/useRoom";
import { getDisplayName, setDisplayName } from "../../../src/client/identity";
import { RoomChat } from "../../../src/ui/RoomChat";
import { RoomLobby } from "../../../src/ui/RoomLobby";
import { TurnClock } from "../../../src/ui/TurnClock";
import { VoicePanel } from "../../../src/ui/VoicePanel";
import { useGameSounds } from "../../../src/audio/useGameSounds";
import { RulesDialog } from "../../../src/ui/RulesDialog";
import { LiarsDiceView } from "../../../src/games/liars-dice/LiarsDiceView";
import type { LiarsDicePlayerView } from "../../../src/games/liars-dice/module";
import { WhotView } from "../../../src/games/whot/WhotView";
import type { WhotPlayerView } from "../../../src/games/whot/module";
import { LudoView } from "../../../src/games/ludo/LudoView";
import type { LudoPlayerView } from "../../../src/games/ludo/module";
import { HoldemView } from "../../../src/games/holdem/HoldemView";
import type { HoldemPlayerView } from "../../../src/games/holdem/module";
import { Crazy8sView } from "../../../src/games/crazy8s/Crazy8sView";
import type { Crazy8sPlayerView } from "../../../src/games/crazy8s/module";
import { SnakesView } from "../../../src/games/snakes/SnakesView";
import type { SnakesPlayerView } from "../../../src/games/snakes/module";
import { ChessView } from "../../../src/games/chess/ChessView";
import type { ChessPlayerView } from "../../../src/games/chess/module";
import { DraughtsView } from "../../../src/games/draughts/DraughtsView";
import type { DraughtsPlayerView } from "../../../src/games/draughts/module";
import { DominoesView } from "../../../src/games/dominoes/DominoesView";
import type { DominoesPlayerView } from "../../../src/games/dominoes/module";
import { WerewolfView } from "../../../src/games/werewolf/WerewolfView";
import type { WerewolfPlayerView } from "../../../src/games/werewolf/module";
import { CodewordsView } from "../../../src/games/codewords/CodewordsView";
import type { CodewordsPlayerView } from "../../../src/games/codewords/module";
import { SketchView } from "../../../src/games/sketch/SketchView";
import type { SketchPlayerView } from "../../../src/games/sketch/module";
import { TriviaView } from "../../../src/games/trivia/TriviaView";
import type { TriviaPlayerView } from "../../../src/games/trivia/module";

const STATUS_LABEL: Record<string, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  closed: "Disconnected",
};

/**
 * Generic room shell.
 *
 * Everything outside `renderGame` is game-agnostic — membership, lobby, chat,
 * spectating and the turn clock all come from the platform. Adding a game
 * means adding a case here plus its module; nothing else in this file changes.
 */
export default function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const [name, setName] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // The host asking to pick something else while a match is on the table.
  const [switching, setSwitching] = useState(false);

  useEffect(() => setName(getDisplayName()), []);

  const room = useRoom(roomId, name);
  const snapshot = room.snapshot;

  // Every game gets audio from here: modules already emit typed events for the
  // activity feed, so the sounds follow those rather than each view wiring its
  // own.
  useGameSounds(snapshot, room.playerId);

  // "Create room" from the gallery carries the chosen game in the URL. Apply
  // it once, and only as host — a guest arriving on a shared link must not
  // silently change the game out from under everyone.
  const searchParams = useSearchParams();
  const requestedGame = searchParams.get("game");
  const appliedGame = useRef(false);
  useEffect(() => {
    if (appliedGame.current || !requestedGame || !snapshot) return;
    if (!room.isHost || snapshot.phase !== "lobby") return;
    if (snapshot.gameId === requestedGame) {
      appliedGame.current = true;
      return;
    }
    if (!snapshot.catalog.some((g) => g.id === requestedGame)) return;
    appliedGame.current = true;
    room.selectGame(requestedGame);
  }, [requestedGame, snapshot, room]);

  useEffect(() => {
    if (snapshot?.phase === "lobby") setSwitching(false);
  }, [snapshot?.phase]);

  function saveName(value: string) {
    setName(value);
    setDisplayName(value);
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function renderGame() {
    if (!snapshot?.view) return null;
    switch (snapshot.gameId) {
      case "liars-dice":
        return (
          <LiarsDiceView
            view={snapshot.view as LiarsDicePlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      case "whot":
        return (
          <WhotView
            view={snapshot.view as WhotPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      case "ludo":
        return (
          <LudoView
            view={snapshot.view as LudoPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      case "holdem":
        return (
          <HoldemView
            view={snapshot.view as HoldemPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      case "crazy8s":
        return (
          <Crazy8sView
            view={snapshot.view as Crazy8sPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      case "snakes":
        return (
          <SnakesView
            view={snapshot.view as SnakesPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      case "chess":
        return (
          <ChessView
            view={snapshot.view as ChessPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      case "draughts":
        return (
          <DraughtsView
            view={snapshot.view as DraughtsPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      case "dominoes":
        return (
          <DominoesView
            view={snapshot.view as DominoesPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      case "werewolf":
        return (
          <WerewolfView
            view={snapshot.view as WerewolfPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      case "codewords":
        return (
          <CodewordsView
            view={snapshot.view as CodewordsPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      case "sketch":
        return (
          <SketchView
            view={snapshot.view as SketchPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
            sendStream={room.sendStream}
            onStream={room.onStream}
          />
        );
      case "trivia":
        return (
          <TriviaView
            view={snapshot.view as TriviaPlayerView}
            playerId={room.playerId}
            isMyTurn={room.isMyTurn}
            isPlaying={snapshot.youArePlaying}
            nameOf={room.nameOf}
            onMove={room.sendMove}
          />
        );
      default:
        return <p>No renderer registered for “{snapshot.gameId}”.</p>;
    }
  }

  return (
    <main>
      <div className="room-head">
        <h1>Table {roomId}</h1>
        <div className="status-controls">
          <span className={`conn-pill conn-${room.status}`}>{STATUS_LABEL[room.status]}</span>
          {snapshot?.gameId === "liars-dice" && (
            <button type="button" className="help-button" onClick={() => setRulesOpen(true)}>
              ❓ How to play
            </button>
          )}
        </div>
      </div>

      <RulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />

      <div className="card-panel invite-panel">
        <label className="name-field">
          <span>Your name</span>
          <input value={name} maxLength={16} placeholder="Pick a name" onChange={(e) => saveName(e.target.value)} />
        </label>
        <button type="button" onClick={copyInvite}>
          {copied ? "✓ Link copied" : "🔗 Copy invite link"}
        </button>
        <Link href="/">← Hub</Link>
      </div>

      {room.error && <p className="error-note">{room.error}</p>}

      {/* An unreachable room server used to sit on "Joining the room…" forever
          with no clue why. Say what is wrong, and how to fix it in dev. */}
      {!snapshot && room.unreachable && (
        <div className="card-panel offline-notice">
          <h2>Can&apos;t reach the room server</h2>
          <p>
            The game server isn&apos;t answering at <code>{room.serverUrl}</code>. Rooms live in a
            separate Cloudflare Worker, so it has to be running alongside the web app.
          </p>
          <p>
            Running locally? Start it in a second terminal:
            <code className="cmd">npm run dev:room</code>
            or run both at once with <code className="cmd">npm run dev:all</code>.
          </p>
          <p className="hint">Retrying automatically — attempt {room.failedAttempts}.</p>
        </div>
      )}

      {!snapshot && !room.unreachable && <p>Joining the room…</p>}

      {snapshot && (
        <div className="room-layout">
          <div className="room-main">
            {snapshot.phase === "lobby" ? (
              <RoomLobby
                snapshot={snapshot}
                playerId={room.playerId}
                isHost={room.isHost}
                onSelectGame={room.selectGame}
                onSetGameOptions={room.setGameOptions}
                onReady={room.setReady}
                onSpectate={room.setSpectate}
                onStart={room.start}
                onLock={room.lock}
                onKick={room.kick}
              />
            ) : (
              <>
                {/* The clock belongs to whoever still has to act. It restarts
                    the moment the turn moves on, so nobody sits watching a
                    countdown for a turn that has already been played. */}
                {/* Sticky, so it stays visible however far the board scrolls —
                    in a party game the whole table needs to read it, not just
                    whoever is holding everyone up. */}
                {snapshot.turnDeadline !== null && snapshot.phase === "playing" && snapshot.currentPlayerId && (
                  <TurnClock
                    deadline={snapshot.turnDeadline}
                    isMyTurn={room.isMyTurn}
                    who={room.nameOf(snapshot.currentPlayerId)}
                    note={room.isMyTurn ? "or you forfeit the turn" : "until they forfeit"}
                  />
                )}
                {renderGame()}
                {snapshot.phase === "finished" && (
                  <div className="card-panel result-banner">
                    <h2>
                      {snapshot.winners?.includes(room.playerId)
                        ? "🏆 You win!"
                        : `${(snapshot.winners ?? []).map(room.nameOf).join(", ") || "Nobody"} wins`}
                    </h2>
                    {room.isHost && (
                      <div className="result-actions">
                        <button type="button" onClick={room.rematch}>
                          Rematch
                        </button>
                        <button type="button" className="ghost" onClick={room.backToLobby}>
                          🎲 Change game
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Mid-match, changing game ends it for everybody, so it asks
                    first — and it lives here rather than only on the results
                    screen, because a group usually decides to switch when the
                    current game is not working out, not after it finishes. */}
                {room.isHost && snapshot.phase === "playing" && (
                  <p className="host-switch">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        if (window.confirm("End this match and pick a different game?")) {
                          room.backToLobby();
                        }
                      }}
                    >
                      🎲 Change game
                    </button>
                  </p>
                )}
              </>
            )}

            {snapshot.events.length > 0 && snapshot.phase !== "lobby" && (
              <aside className="card-panel event-feed">
                <h3>Table talk</h3>
                <ol>
                  {snapshot.events.slice(-14).map((e, i) => (
                    <li key={i} className={`log-${e.type}`}>
                      {e.playerId ? <strong>{room.nameOf(e.playerId)} </strong> : null}
                      {e.text}
                    </li>
                  ))}
                </ol>
              </aside>
            )}
          </div>

          <div className="room-side">
            <VoicePanel
              playerId={room.playerId}
              members={snapshot.members}
              nameOf={room.nameOf}
              sendVoice={room.sendVoice}
              onVoice={room.onVoice}
              announceVoice={room.announceVoice}
            />
            <RoomChat
              chat={snapshot.chat}
              nameOf={room.nameOf}
              onSend={room.sendChat}
              onEmote={room.sendEmote}
            />
          </div>
        </div>
      )}
    </main>
  );
}
