"use client";

import { useMemo, useState } from "react";
import { DiceTable } from "../../animation/DiceTable";
import { BidControls } from "../../ui/BidControls";
import { BluffScorePanel } from "../../ui/BluffScorePanel";
import { buildPostMatchReport } from "../../engine/bluffScore";
import { isValidBidTransition } from "../../engine/game";
import type { Bid, Face, GameState } from "../../engine/types";
import type { LiarsDicePlayerView, LiarsDiceMove } from "./module";

export interface LiarsDiceViewProps {
  view: LiarsDicePlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: LiarsDiceMove) => void;
}

/**
 * Liar's Dice renderer.
 *
 * Reads only the module's redacted view — it has no access to, and no notion
 * of, anyone else's dice. Legal bids are recomputed here purely to keep the
 * controls honest; the server validates independently and is authoritative.
 */
export function LiarsDiceView({
  view,
  playerId,
  isMyTurn,
  isPlaying,
  nameOf,
  onMove,
}: LiarsDiceViewProps) {
  const [mode, setMode] = useState<"auto" | "3d" | "2d">("auto");
  const [rollSeed, setRollSeed] = useState(0);

  // Re-roll the dice animation whenever the round changes.
  const roundRef = useMemo(() => ({ round: view.round }), []);
  if (roundRef.round !== view.round) {
    roundRef.round = view.round;
    queueMicrotask(() => setRollSeed((s) => s + 1));
  }

  const legalBids = useMemo(() => {
    if (!isMyTurn) return [];
    const total = view.players.reduce((sum, p) => sum + p.diceCount, 0);
    const bids: Bid[] = [];
    for (let quantity = 1; quantity <= total; quantity++) {
      for (const face of [1, 2, 3, 4, 5, 6] as Face[]) {
        const bid = { quantity, face };
        if (isValidBidTransition(view.currentBid, bid, view.palifico)) bids.push(bid);
      }
    }
    return bids;
  }, [view, isMyTurn]);

  const report = useMemo(() => {
    if (!view.finished) return null;
    // Rebuild a report-shaped state from the public history. Dice stay empty:
    // this client legitimately never learned them.
    const synthetic: GameState = {
      players: view.players.map((p) => ({
        id: p.id,
        diceCount: p.diceCount,
        dice: [],
        eliminated: p.eliminated,
      })),
      currentPlayerIndex: 0,
      currentBid: null,
      bidderIndex: null,
      round: view.round,
      palifico: view.palifico,
      phase: "gameOver",
      winnerId: view.winnerId,
      history: view.history,
      rngSeed: 0,
    };
    return buildPostMatchReport(synthetic);
  }, [view]);

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            <>Match over — {nameOf(view.winnerId ?? "")} wins.</>
          ) : isMyTurn ? (
            <strong>Your turn.</strong>
          ) : (
            <>
              Waiting on <strong>{nameOf(view.currentPlayerId ?? "")}</strong>…
            </>
          )}{" "}
          {view.currentBid
            ? `Current bid: ${view.currentBid.quantity} × ${view.currentBid.face}`
            : view.finished
            ? ""
            : "No bid yet."}
        </p>
        <div className="status-controls">
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="auto">Auto</option>
            <option value="3d">Force 3D</option>
            <option value="2d">Force 2D</option>
          </select>
        </div>
      </div>

      <div className="seat-strip">
        {view.players.map((p) => (
          <div
            key={p.id}
            className={[
              "seat",
              p.eliminated ? "eliminated" : "",
              view.currentPlayerId === p.id && !view.finished ? "active" : "",
              p.id === playerId ? "viewer" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="seat-name">
              {nameOf(p.id)}
              {p.id === playerId ? " (you)" : ""}
            </span>
            <span className="seat-dice">{p.eliminated ? "out" : "🎲".repeat(p.diceCount)}</span>
          </div>
        ))}
      </div>

      <div className="table-frame">
        <div className="table-frame-inner">
          <DiceTable dice={view.dice} rollSeed={rollSeed} mode={mode} />
        </div>
      </div>

      {view.lastResult && !view.finished && (
        <p className="last-result">
          {nameOf(view.lastResult.challengerId)} called {nameOf(view.lastResult.bidderId)}&apos;s{" "}
          {view.lastResult.bid.quantity} × {view.lastResult.bid.face} — there were{" "}
          {view.lastResult.actualCount}. {nameOf(view.lastResult.loserId)} lost a die.
        </p>
      )}

      {!view.finished && (
        <div className="card-panel play-panel">
          {!isPlaying ? (
            <p className="spectator-note">👀 Spectating — you can see every hand.</p>
          ) : view.seesAllHands ? (
            <p className="spectator-note">👀 You&apos;re out — watching the rest play it out.</p>
          ) : (
            <BidControls
              legalBids={legalBids}
              currentBid={view.currentBid}
              palifico={view.palifico}
              canChallenge={isMyTurn && view.currentBid !== null}
              disabled={!isMyTurn}
              onBid={(bid) => onMove({ type: "bid", bid })}
              onChallenge={() => onMove({ type: "challenge" })}
            />
          )}
        </div>
      )}

      {report && (
        <BluffScorePanel
          report={report}
          playerNames={Object.fromEntries(view.players.map((p) => [p.id, nameOf(p.id)]))}
        />
      )}
    </>
  );
}
