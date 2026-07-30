"use client";

import { useEffect, useMemo, useState } from "react";
import { BOARD, isPlayableSquare } from "./rules";
import { squareName, type DraughtsMove, type DraughtsPlayerView } from "./module";

export interface DraughtsViewProps {
  view: DraughtsPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: DraughtsMove) => void;
}

const key = (r: number, c: number) => `${r},${c}`;

/**
 * Draughts board.
 *
 * Legality comes entirely from `view.legalMoves`, which the server generated —
 * including the forced-capture rule. This component only decides what to
 * highlight, so it can never offer a move the server would reject.
 */
export function DraughtsView({ view, playerId, isMyTurn, isPlaying, nameOf, onMove }: DraughtsViewProps) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!isMyTurn) setSelected(null);
  }, [isMyTurn]);

  // Mid-chain the server locks you to one piece; select it automatically so
  // there is no confusing "why can't I move anything else" moment.
  useEffect(() => {
    if (view.chaining) setSelected(key(view.chaining[0], view.chaining[1]));
  }, [view.chaining]);

  const movableFrom = useMemo(
    () => new Set(view.legalMoves.map((m) => key(m.from[0], m.from[1]))),
    [view.legalMoves]
  );

  const targets = useMemo(() => {
    if (!selected) return new Map<string, boolean>();
    const map = new Map<string, boolean>();
    for (const m of view.legalMoves) {
      if (key(m.from[0], m.from[1]) !== selected) continue;
      // A jump moves two rows; anything else is a quiet step.
      map.set(key(m.to[0], m.to[1]), Math.abs(m.to[0] - m.from[0]) > 1);
    }
    return map;
  }, [selected, view.legalMoves]);

  // Dark plays from the far side, so flip the board for them.
  const flipped = view.mySide === "dark";
  const rowOrder = flipped ? [...Array(BOARD).keys()].reverse() : [...Array(BOARD).keys()];
  const colOrder = flipped ? [...Array(BOARD).keys()].reverse() : [...Array(BOARD).keys()];

  function clickSquare(r: number, c: number) {
    if (!isMyTurn || view.finished) return;
    const id = key(r, c);

    if (selected && targets.has(id)) {
      const [sr, sc] = selected.split(",").map(Number) as [number, number];
      onMove({ type: "move", from: [sr, sc], to: [r, c] });
      setSelected(null);
      return;
    }
    if (movableFrom.has(id)) {
      setSelected(id === selected ? null : id);
      return;
    }
    setSelected(null);
  }

  const lastFrom = view.lastMove ? key(view.lastMove.from[0], view.lastMove.from[1]) : null;
  const lastTo = view.lastMove ? key(view.lastMove.to[0], view.lastMove.to[1]) : null;

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            view.drawn ? (
              <>Drawn — forty moves without a capture.</>
            ) : (
              <>{nameOf(view.winners[0] ?? "")} wins.</>
            )
          ) : isMyTurn ? (
            <strong>
              {view.chaining ? "Keep jumping — you must take again." : "Your move."}
              {view.captureRequired && !view.chaining ? " A capture is compulsory." : ""}
            </strong>
          ) : (
            <>
              Waiting on <strong>{nameOf(view.currentPlayerId ?? "")}</strong>…
            </>
          )}
        </p>
        <span className="whot-rules-badge">{view.rulesName}</span>
      </div>

      <div className="ludo-layout">
        <div className="draughts-board">
          {rowOrder.map((r) =>
            colOrder.map((c) => {
              const id = key(r, c);
              const piece = view.board[r]![c];
              const playable = isPlayableSquare(r, c);
              const isTarget = targets.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={[
                    "draughts-square",
                    playable ? "playable" : "blocked",
                    selected === id ? "selected" : "",
                    isTarget ? (targets.get(id) ? "target capture" : "target") : "",
                    id === lastFrom || id === lastTo ? "last-move" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={!isMyTurn || view.finished || (!movableFrom.has(id) && !isTarget)}
                  onClick={() => clickSquare(r, c)}
                  aria-label={`${squareName([r, c])}${piece ? ` ${piece.side} ${piece.king ? "king" : "man"}` : ""}`}
                >
                  {piece && (
                    <span className={`draught piece-${piece.side}${piece.king ? " king" : ""}`}>
                      {piece.king && <span className="crown">♛</span>}
                    </span>
                  )}
                  {isTarget && !piece && <span className="target-dot" />}
                </button>
              );
            })
          )}
        </div>

        <div className="ludo-side">
          <div className="card-panel">
            <h3 className="hand-heading">Players</h3>
            <ul className="ludo-legend">
              {view.players.map((p) => (
                <li key={p.id} className={view.currentPlayerId === p.id ? "active" : ""}>
                  <span className={`draught-swatch piece-${p.side}`} />
                  {nameOf(p.id)}
                  {p.id === playerId ? " (you)" : ""}
                  <span className="legend-count">
                    {p.pieces} left{p.kings > 0 ? ` · ${p.kings} king${p.kings > 1 ? "s" : ""}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {view.captureRequired && isMyTurn && !view.finished && (
            <p className="capture-warning">⚠ A capture is available, so it must be taken.</p>
          )}

          {!isPlaying && <p className="spectator-note">👀 Spectating — draughts hides nothing.</p>}
          {isMyTurn && !view.finished && (
            <p className="hint">
              {selected ? "Pick a highlighted square." : "Tap one of your pieces to see its moves."}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
