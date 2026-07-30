"use client";

import { useEffect, useRef, useState } from "react";
import { DominoTile } from "./DominoTile";
import type { DominoesEnd, DominoesMove, DominoesPlayerView } from "./module";

export interface DominoesViewProps {
  view: DominoesPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: DominoesMove) => void;
}

const END_LABEL: Record<DominoesEnd, string> = { left: "left end", right: "right end" };

/**
 * Dominoes renderer.
 *
 * Reads only the redacted view: own tiles in full, opponents as counts. The
 * layout grows in both directions, so it scrolls its own box rather than the
 * page, and follows the newest tile.
 */
export function DominoesView({ view, playerId, isMyTurn, isPlaying, nameOf, onMove }: DominoesViewProps) {
  const [pending, setPending] = useState<string | null>(null);
  const chainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMyTurn) setPending(null);
  }, [isMyTurn]);

  // Keep the freshest end of the chain in view without moving the page.
  useEffect(() => {
    const box = chainRef.current;
    if (box) box.scrollLeft = box.scrollWidth;
  }, [view.layout.length]);

  const fits = new Map(view.playable.map((p) => [p.tileId, p.ends]));
  const pendingEnds = pending ? fits.get(pending) ?? [] : [];

  function pick(tileId: string) {
    const ends = fits.get(tileId);
    if (!ends || ends.length === 0) return;
    // One legal end needs no question; two do.
    if (ends.length === 1) return onMove({ type: "play", tileId, end: ends[0]! });
    setPending(tileId);
  }

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            <>
              Game over —{" "}
              {view.endReason === "blocked"
                ? "the game blocked; lowest pip count wins."
                : `${nameOf(view.winners[0] ?? "")} played out.`}
            </>
          ) : isMyTurn ? (
            <strong>Your turn.</strong>
          ) : (
            <>
              Waiting on <strong>{nameOf(view.currentPlayerId ?? "")}</strong>…
            </>
          )}
          <span className="whot-demand">
            open ends: {view.openEnds.left ?? "—"} / {view.openEnds.right ?? "—"}
          </span>
          <span className="whot-debt">boneyard {view.boneyardCount}</span>
        </p>
        <span className="whot-rules-badge">{view.rulesName}</span>
      </div>

      <div className="seat-strip">
        {view.opponents.map((o) => (
          <div key={o.id} className={`seat${view.currentPlayerId === o.id ? " active" : ""}`}>
            <span className="seat-name">{nameOf(o.id)}</span>
            <span className="seat-dice">
              {"🁢".repeat(Math.min(o.tileCount, 10))} {o.tileCount}
            </span>
          </div>
        ))}
        <div className={`seat viewer${view.currentPlayerId === playerId ? " active" : ""}`}>
          <span className="seat-name">{nameOf(playerId)} (you)</span>
          <span className="seat-dice">{view.myHand.length} tiles</span>
        </div>
      </div>

      <div className="card-panel domino-table">
        <div className="domino-chain" ref={chainRef}>
          {view.layout.length === 0 ? (
            <p className="hint">Empty table — the opener goes down first.</p>
          ) : (
            view.layout.map((t) => (
              <DominoTile
                key={t.id}
                a={t.left}
                b={t.right}
                orientation={t.isDouble ? "vertical" : "horizontal"}
              />
            ))
          )}
        </div>

        {isPlaying && !view.finished && (
          <div className="table-actions">
            {view.canDraw && (
              <button type="button" disabled={!isMyTurn} onClick={() => onMove({ type: "draw" })}>
                Draw from boneyard
              </button>
            )}
            {isMyTurn && view.mustPass && (
              <button type="button" onClick={() => onMove({ type: "pass" })}>
                Pass
              </button>
            )}
          </div>
        )}
      </div>

      {pending && (
        <div className="card-panel shape-chooser">
          <p>Which end?</p>
          <div className="shape-buttons">
            {pendingEnds.map((end) => (
              <button
                key={end}
                type="button"
                onClick={() => {
                  onMove({ type: "play", tileId: pending, end });
                  setPending(null);
                }}
              >
                {END_LABEL[end]} · {end === "left" ? view.openEnds.left : view.openEnds.right}
              </button>
            ))}
          </div>
          <button type="button" className="ghost" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}

      {isPlaying && (
        <div className="card-panel play-panel">
          <h3 className="hand-heading">
            Your tiles · {view.myHand.length}
            {isMyTurn && view.mustPass && " · nothing fits"}
          </h3>
          <div className="domino-hand">
            {view.myHand.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`hand-domino${fits.has(t.id) ? " playable" : ""}${pending === t.id ? " chosen" : ""}`}
                disabled={!isMyTurn || !fits.has(t.id)}
                onClick={() => pick(t.id)}
              >
                <DominoTile a={t.a} b={t.b} />
              </button>
            ))}
          </div>
        </div>
      )}

      {!isPlaying && <p className="spectator-note">👀 Spectating — you can see every hand.</p>}

      {view.finished && view.finalPips && (
        <div className="card-panel">
          <h3 className="hand-heading">Pips left</h3>
          <ul className="all-hands">
            {Object.entries(view.finalPips).map(([owner, pips]) => (
              <li key={owner}>
                <strong>{nameOf(owner)}</strong>
                <span>{pips}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.seesAllHands && (view.finished || !isPlaying) && (
        <div className="card-panel">
          <h3 className="hand-heading">Hands</h3>
          <ul className="all-hands">
            {Object.entries(view.allHands).map(([owner, tiles]) => (
              <li key={owner}>
                <strong>{nameOf(owner)}</strong>
                <span className="domino-hand small">
                  {tiles.map((t) => (
                    <DominoTile key={t.id} a={t.a} b={t.b} size="small" />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
