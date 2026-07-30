"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { DiceTable } from "../../../src/animation/DiceTable";
import { BidControls } from "../../../src/ui/BidControls";
import { BluffScorePanel } from "../../../src/ui/BluffScorePanel";
import { RulesDialog } from "../../../src/ui/RulesDialog";
import { buildPostMatchReport } from "../../../src/engine/bluffScore";
import { useLocalGame } from "../../../src/client/useLocalGame";

const PLAYER_NAMES = ["You", "Rosa", "Kwame", "Ingrid"];

export default function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const [mode, setMode] = useState<"auto" | "3d" | "2d">("auto");
  const [rulesOpen, setRulesOpen] = useState(false);

  const game = useLocalGame({ playerNames: PLAYER_NAMES, viewerIndex: 0 });
  const { state, viewerId, reveal } = game;

  const report = useMemo(
    () => (state.phase === "gameOver" ? buildPostMatchReport(state) : null),
    [state]
  );

  const viewer = state.players.find((p) => p.id === viewerId)!;
  const activeCount = state.players.filter((p) => !p.eliminated).length;
  const currentPlayer = state.players[state.currentPlayerIndex];

  return (
    <main>
      <div className="room-head">
        <h1>Room {roomId}</h1>
        <button type="button" className="help-button" onClick={() => setRulesOpen(true)}>
          ❓ How to play
        </button>
      </div>

      <RulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />

      <div className="status-bar card-panel">
        <StatusLine game={game} />
        <div className="status-controls">
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="auto">Auto</option>
            <option value="3d">Force 3D</option>
            <option value="2d">Force 2D</option>
          </select>
          <button type="button" onClick={game.restart}>
            New match
          </button>
        </div>
      </div>

      {game.error && <p className="error-note">{game.error}</p>}

      <div className="seat-strip">
        {state.players.map((p) => (
          <div
            key={p.id}
            className={[
              "seat",
              p.eliminated ? "eliminated" : "",
              !p.eliminated && currentPlayer?.id === p.id && state.phase === "bidding" && !reveal
                ? "active"
                : "",
              p.id === viewerId ? "viewer" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="seat-name">{p.id}</span>
            <span className="seat-dice">{p.eliminated ? "out" : "🎲".repeat(p.diceCount)}</span>
            {game.thinkingPlayerId === p.id && <span className="seat-thinking">thinking…</span>}
          </div>
        ))}
      </div>

      <div className="table-layout">
        <div className="table-frame">
          <div className="table-frame-inner">
            <DiceTable dice={game.dice} rollSeed={game.rollSeed} mode={mode} />
          </div>
        </div>
        <MoveLog game={game} />
      </div>

      {state.phase === "bidding" && (
        <div className="card-panel play-panel">
          {game.viewerEliminated ? (
            <p className="spectator-note">
              👀 You&apos;re out — spectating. All hands are visible to you now.
            </p>
          ) : (
            <BidControls
              legalBids={game.legalBids}
              currentBid={state.currentBid}
              palifico={state.palifico}
              canChallenge={game.canChallenge}
              disabled={!game.isViewerTurn}
              onBid={game.submitBid}
              onChallenge={game.submitChallenge}
            />
          )}
        </div>
      )}

      {state.phase === "gameOver" && report && (
        <>
          <div className="card-panel result-banner">
            <h2>{state.winnerId === viewerId ? "🏆 You win!" : `${state.winnerId} wins`}</h2>
            <button type="button" onClick={game.restart}>
              Play again
            </button>
          </div>
          <BluffScorePanel report={report} />
        </>
      )}

      <p className="footnote">
        {activeCount} of {state.players.length} still in · {viewer.diceCount} dice in your hand · round{" "}
        {state.round}
      </p>
    </main>
  );
}

/** Running feed of every action, so opponents' turns are visible as they happen. */
function MoveLog({ game }: { game: ReturnType<typeof useLocalGame> }) {
  const logRef = useRef<HTMLOListElement>(null);
  const lastCount = useRef(game.log.length);

  // Scroll the log's own box, never the page — scrollIntoView walks up to the
  // nearest scrollable ancestor and yanks the window on every update.
  useEffect(() => {
    if (game.log.length === lastCount.current) return;
    lastCount.current = game.log.length;
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [game.log.length]);

  return (
    <aside className="move-log card-panel" aria-live="polite">
      <h3>Table talk</h3>
      <ol ref={logRef}>
        {game.log.map((entry) => (
          <li key={entry.id} className={`log-${entry.kind}`}>
            {entry.text}
          </li>
        ))}
      </ol>
      {game.thinkingPlayerId && (
        <p className="log-thinking">{game.thinkingPlayerId} is thinking…</p>
      )}
    </aside>
  );
}

function StatusLine({ game }: { game: ReturnType<typeof useLocalGame> }) {
  const { state, reveal, isViewerTurn, viewerId } = game;

  if (reveal) {
    const loserIsViewer = reveal.loserId === viewerId;
    return (
      <p className="status-line">
        <strong>{reveal.challengerId}</strong> called <strong>{reveal.bidderId}</strong>&apos;s bid of{" "}
        <strong>
          {reveal.bid.quantity} × {reveal.bid.face}
        </strong>{" "}
        — actually <strong>{reveal.actualCount}</strong>.{" "}
        {reveal.bidderWon ? `${reveal.challengerId} loses a die.` : `${reveal.bidderId} loses a die.`}
        {loserIsViewer ? " 💀" : ""}
      </p>
    );
  }

  if (state.phase === "gameOver") {
    return <p className="status-line">Match over.</p>;
  }

  const current = state.players[state.currentPlayerIndex];
  const bidText = state.currentBid
    ? `Current bid: ${state.currentBid.quantity} × ${state.currentBid.face}`
    : "No bid yet — open the round.";

  return (
    <p className="status-line">
      {isViewerTurn ? (
        <strong>Your turn.</strong>
      ) : (
        <>
          Waiting on <strong>{current?.id}</strong>…
        </>
      )}{" "}
      {bidText}
    </p>
  );
}
