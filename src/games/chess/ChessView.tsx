"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChessMove, ChessPlayerView } from "./module";

export interface ChessViewProps {
  view: ChessPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: ChessMove) => void;
}

const GLYPH: Record<string, string> = {
  wk: "♚", wq: "♛", wr: "♜", wb: "♝", wn: "♞", wp: "♟",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
};

const FILES = "abcdefgh";
const PROMOTION_PIECES: Array<{ code: "q" | "r" | "b" | "n"; label: string }> = [
  { code: "q", label: "Queen" },
  { code: "r", label: "Rook" },
  { code: "b", label: "Bishop" },
  { code: "n", label: "Knight" },
];

/** Board row/col → algebraic square. Row 0 is rank 8, col 0 is file a. */
const squareOf = (row: number, col: number) => `${FILES[col]}${8 - row}`;

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Chess board.
 *
 * Every legality question is answered by `view.legalMoves`, which the server
 * produced from chess.js — this component never reasons about pins, castling
 * rights or en passant. It only decides what to highlight.
 */
export function ChessView({ view, playerId, isMyTurn, isPlaying, nameOf, onMove }: ChessViewProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);

  // Drop a stale selection when the turn moves on.
  useEffect(() => {
    if (!isMyTurn) {
      setSelected(null);
      setPendingPromotion(null);
    }
  }, [isMyTurn]);

  /** Squares this player may move a piece from. */
  const movableFrom = useMemo(
    () => new Set(view.legalMoves.map((m) => m.from)),
    [view.legalMoves]
  );

  /** Legal destinations for the currently selected piece. */
  const targets = useMemo(() => {
    if (!selected) return new Map<string, boolean>();
    const map = new Map<string, boolean>();
    for (const m of view.legalMoves) {
      if (m.from === selected) map.set(m.to, !!m.captured);
    }
    return map;
  }, [selected, view.legalMoves]);

  // Black sees the board from their own side.
  const flipped = view.myColor === "b";
  const rows = flipped ? [...view.board].reverse() : view.board;

  function clickSquare(square: string, piece: string | null) {
    if (!isMyTurn || view.finished) return;

    if (selected && targets.has(square)) {
      // A pawn arriving on the last rank has to be told what to become.
      const needsPromotion = view.legalMoves.some(
        (m) => m.from === selected && m.to === square && m.promotion
      );
      if (needsPromotion) return setPendingPromotion({ from: selected, to: square });
      onMove({ type: "move", from: selected, to: square });
      setSelected(null);
      return;
    }

    // Selecting (or re-selecting) one of your own pieces.
    if (piece && movableFrom.has(square)) {
      setSelected(square === selected ? null : square);
      return;
    }
    setSelected(null);
  }

  const white = view.players.find((p) => p.color === "w");
  const black = view.players.find((p) => p.color === "b");

  /** Move list paired up as numbered full moves. */
  const pairs: Array<[string, string | undefined]> = [];
  for (let i = 0; i < view.history.length; i += 2) {
    pairs.push([view.history[i]!, view.history[i + 1]]);
  }

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            view.drawn ? (
              <>Drawn — {(view.endReason ?? "").replace(/-/g, " ")}.</>
            ) : (
              <>
                {nameOf(view.winners[0] ?? "")} wins by {(view.endReason ?? "").replace(/-/g, " ")}.
              </>
            )
          ) : isMyTurn ? (
            <strong>Your move.{view.inCheck ? " You're in check!" : ""}</strong>
          ) : (
            <>
              Waiting on <strong>{nameOf(view.currentPlayerId ?? "")}</strong>
              {view.inCheck ? " — they're in check" : ""}…
            </>
          )}
        </p>
        <span className="whot-rules-badge">{view.rulesName}</span>
      </div>

      <div className="ludo-layout">
        <div className="chess-board-wrap">
          {/* Opponent's clock sits above the board, yours below, as at a real table. */}
          {view.clock && (
            <div className={`chess-clock${view.turn !== view.myColor ? " ticking" : ""}`}>
              <span>{nameOf((flipped ? white : black)?.id ?? "")}</span>
              <strong>{formatClock(flipped ? view.clock.w : view.clock.b)}</strong>
            </div>
          )}

          <div className={`chess-board${flipped ? " flipped" : ""}`}>
            {rows.map((row, rIdx) => {
              const boardRow = flipped ? 7 - rIdx : rIdx;
              const cells = flipped ? [...row].reverse() : row;
              return cells.map((piece, cIdx) => {
                const boardCol = flipped ? 7 - cIdx : cIdx;
                const square = squareOf(boardRow, boardCol);
                const dark = (boardRow + boardCol) % 2 === 1;
                const isTarget = targets.has(square);
                const isCapture = targets.get(square) === true;
                const isLast = view.lastMove?.from === square || view.lastMove?.to === square;
                const inCheckSquare =
                  view.inCheck && piece === `${view.turn}k` ? " in-check" : "";
                return (
                  <button
                    key={square}
                    type="button"
                    className={[
                      "chess-square",
                      dark ? "dark" : "light",
                      selected === square ? "selected" : "",
                      isTarget ? (isCapture ? "target capture" : "target") : "",
                      isLast ? "last-move" : "",
                      inCheckSquare,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={!isMyTurn || view.finished}
                    onClick={() => clickSquare(square, piece)}
                    aria-label={`${square}${piece ? ` ${piece}` : " empty"}`}
                  >
                    {piece && (
                      <span className={`chess-piece ${piece.startsWith("w") ? "white" : "black"}`}>
                        {GLYPH[piece]}
                      </span>
                    )}
                    {isTarget && !piece && <span className="target-dot" />}
                    {/* Coordinates along the edges, like a printed board. */}
                    {boardCol === (flipped ? 7 : 0) && <span className="rank-label">{8 - boardRow}</span>}
                    {boardRow === (flipped ? 0 : 7) && <span className="file-label">{FILES[boardCol]}</span>}
                  </button>
                );
              });
            })}
          </div>

          {view.clock && (
            <div className={`chess-clock${view.turn === view.myColor ? " ticking" : ""}`}>
              <span>{nameOf((flipped ? black : white)?.id ?? "")}</span>
              <strong>{formatClock(flipped ? view.clock.b : view.clock.w)}</strong>
            </div>
          )}
        </div>

        <div className="ludo-side">
          <div className="card-panel">
            <h3 className="hand-heading">Players</h3>
            <ul className="ludo-legend">
              {view.players.map((p) => (
                <li key={p.id} className={view.currentPlayerId === p.id ? "active" : ""}>
                  <span className={`chess-swatch ${p.color === "w" ? "white" : "black"}`} />
                  {nameOf(p.id)}
                  {p.id === playerId ? " (you)" : ""}
                  <span className="legend-count">{p.color === "w" ? "White" : "Black"}</span>
                </li>
              ))}
            </ul>
          </div>

          {pendingPromotion && (
            <div className="card-panel shape-chooser">
              <p>Promote to:</p>
              <div className="shape-buttons">
                {PROMOTION_PIECES.map((piece) => (
                  <button
                    key={piece.code}
                    type="button"
                    onClick={() => {
                      onMove({ type: "move", ...pendingPromotion, promotion: piece.code });
                      setPendingPromotion(null);
                      setSelected(null);
                    }}
                  >
                    {GLYPH[`${view.myColor}${piece.code}`]} {piece.label}
                  </button>
                ))}
              </div>
              <button type="button" className="ghost" onClick={() => setPendingPromotion(null)}>
                Cancel
              </button>
            </div>
          )}

          <div className="card-panel move-list-panel">
            <h3 className="hand-heading">Moves</h3>
            {pairs.length === 0 ? (
              <p className="hint">No moves yet.</p>
            ) : (
              <ol className="move-list">
                {pairs.map(([w, b], i) => (
                  <li key={i}>
                    <span className="move-no">{i + 1}.</span>
                    <span>{w}</span>
                    <span>{b ?? ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {!isPlaying && <p className="spectator-note">👀 Spectating — chess hides nothing.</p>}
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
