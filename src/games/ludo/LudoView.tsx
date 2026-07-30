"use client";

import { useEffect, useRef, useState } from "react";
import {
  BASE_RECTS,
  BASE_SLOTS,
  COLORS,
  ENTRY_SQUARES,
  GRID,
  HOME_COLUMN_COORDS,
  SAFE_SQUARES,
  TRACK_COORDS,
  TRACK_LENGTH,
  type LudoColor,
} from "./rules";
import type { LudoMove, LudoPlayerView } from "./module";

export interface LudoViewProps {
  view: LudoPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: LudoMove) => void;
}

/** Grid placement helper — CSS grid lines are 1-indexed. */
const at = (x: number, y: number, w = 1, h = 1) => ({
  gridColumn: `${x + 1} / span ${w}`,
  gridRow: `${y + 1} / span ${h}`,
});

function DiePips({ value }: { value: number }) {
  const layouts: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
  };
  return (
    <>
      {(layouts[value] ?? []).map(([col, row], i) => (
        <span key={i} className="die-pip" style={{ gridColumn: col + 1, gridRow: row + 1 }} />
      ))}
    </>
  );
}

export function LudoView({ view, playerId, isMyTurn, isPlaying, nameOf, onMove }: LudoViewProps) {
  const [rolling, setRolling] = useState(false);
  const lastRollCount = useRef(view.rollCount);

  // The server decided the number; this only plays the tumble that reveals it.
  useEffect(() => {
    if (view.rollCount === lastRollCount.current) return;
    lastRollCount.current = view.rollCount;
    setRolling(true);
    const timer = setTimeout(() => setRolling(false), 550);
    return () => clearTimeout(timer);
  }, [view.rollCount]);

  const me = view.players.find((p) => p.id === playerId) ?? null;
  const movable = new Set(view.movablePawns);

  /** Pawns sitting on the shared track, keyed by track index. */
  const onTrack = new Map<number, Array<{ color: LudoColor; owner: string; pawn: number }>>();
  view.players.forEach((player) => {
    player.pawns.forEach((pawn, index) => {
      if (pawn.square === null) return;
      const list = onTrack.get(pawn.square) ?? [];
      list.push({ color: player.color, owner: player.id, pawn: index });
      onTrack.set(pawn.square, list);
    });
  });

  /** True when this pawn belongs to the viewer and is legal to move now. */
  const canSelect = (owner: string, pawnIndex: number) =>
    isMyTurn && !view.mustRoll && owner === playerId && movable.has(pawnIndex);

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            <>Race over — {nameOf(view.winners[0] ?? "")} wins.</>
          ) : isMyTurn ? (
            <strong>{view.mustRoll ? "Your turn — roll." : "Pick a pawn to move."}</strong>
          ) : (
            <>
              Waiting on <strong>{nameOf(view.currentPlayerId ?? "")}</strong>…
            </>
          )}
          {view.lastRoll !== null && (
            <span className="last-roll">
              last roll {view.lastRoll}
              {view.lastRollBy ? ` (${nameOf(view.lastRollBy)})` : ""}
            </span>
          )}
        </p>
        <span className="whot-rules-badge">{view.rulesName}</span>
      </div>

      {/* Opponents belong on screen, not tucked into a side legend. */}
      <div className="seat-strip">
        {view.players.map((p) => (
          <div
            key={p.id}
            className={[
              "seat",
              view.currentPlayerId === p.id && !view.finished ? "active" : "",
              p.id === playerId ? "viewer" : "",
              p.pawnsHome === 4 ? "eliminated" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="seat-name">
              <span className={`colour-dot dot-${p.color}`} />
              {nameOf(p.id)}
              {p.id === playerId ? " (you)" : ""}
            </span>
            <span className="seat-dice">
              🏠 {p.pawnsHome}/4 · {p.pawns.filter((pawn) => pawn.inBase).length} in base ·{" "}
              {p.pawns.filter((pawn) => !pawn.inBase && !pawn.home).length} out
            </span>
          </div>
        ))}
      </div>

      <div className="ludo-layout">
        <div className="ludo-board-cross" style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)`, gridTemplateRows: `repeat(${GRID}, 1fr)` }}>
          {/* Corner bases, one per seat */}
          {BASE_RECTS.map((rect, seat) => {
            const player = view.players[seat];
            // The board always shows four colours. Seats may be empty — that
            // means no pawns in that base, not a colourless corner.
            const color = COLORS[seat]!;
            const [bx, by, bw, bh] = rect;
            return (
              <div key={`base${seat}`} className={`ludo-base base-${color}`} style={at(bx, by, bw, bh)}>
                <div className="base-inner">
                  {(player?.pawns ?? []).map((pawn, i) => {
                    const selectable = !!player && pawn.inBase && canSelect(player.id, i);
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`pawn-slot${selectable ? " selectable" : ""}`}
                        style={at(BASE_SLOTS[i]![0], BASE_SLOTS[i]![1])}
                        disabled={!selectable}
                        title={selectable ? "Bring this pawn out" : undefined}
                        onClick={() => selectable && onMove({ type: "movePawn", pawn: i })}
                      >
                        <span className={`pawn base-pawn dot-${color}${pawn.inBase ? "" : " spent"}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* The 52-cell track */}
          {TRACK_COORDS.map(([x, y], index) => {
            const entrySeat = ENTRY_SQUARES.indexOf(index);
            const entryColor = entrySeat >= 0 ? COLORS[entrySeat] : undefined;
            const safe = view.safeSquaresEnabled && SAFE_SQUARES.has(index);
            const occupants = onTrack.get(index) ?? [];
            return (
              <div
                key={`t${index}`}
                className={`cross-cell${safe ? " safe" : ""}${entryColor ? ` entry-fill entry-${entryColor}` : ""}`}
                style={at(x, y)}
                title={`square ${index}${safe ? " · safe" : ""}`}
              >
                {safe && occupants.length === 0 && <span className="star">★</span>}
                {occupants.slice(0, 3).map((o, i) => {
                  const selectable = canSelect(o.owner, o.pawn);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`pawn-slot${selectable ? " selectable" : ""}`}
                      style={{
                        position: "absolute",
                        transform: `translate(${(i - (occupants.length - 1) / 2) * 5}px, 0)`,
                      }}
                      disabled={!selectable}
                      title={selectable ? `Move this pawn ${view.dice}` : undefined}
                      onClick={() => selectable && onMove({ type: "movePawn", pawn: o.pawn })}
                    >
                      <span className={`pawn dot-${o.color}`} />
                    </button>
                  );
                })}
                {occupants.length > 3 && <span className="stack-count">{occupants.length}</span>}
              </div>
            );
          })}

          {/* Colour-coded home columns running into the centre */}
          {HOME_COLUMN_COORDS.map((column, seat) => {
            const player = view.players[seat];
            const color = COLORS[seat]!;
            return column.map(([x, y], step) => {
              const here = (player?.pawns ?? []).filter(
                (p) => !p.inBase && !p.home && p.progress >= TRACK_LENGTH && p.progress - TRACK_LENGTH === step
              );
              return (
                <div key={`h${seat}-${step}`} className={`cross-cell home-run home-${color}`} style={at(x, y)}>
                  {here.map((_, i) => (
                    <span key={i} className={`pawn dot-${color}`} />
                  ))}
                </div>
              );
            });
          })}

          {/* Centre home */}
          {/* Centre home: four triangles meeting in the middle, one per seat,
              each pointing back down that colour's home column. */}
          <div className="ludo-home" style={at(6, 6, 3, 3)}>
            {COLORS.map((color, seat) => {
              const player = view.players[seat];
              return (
                <span
                  key={color}
                  className={`home-wedge wedge-${["left", "top", "right", "bottom"][seat]} dot-${color}`}
                  title={player ? `${nameOf(player.id)}: ${player.pawnsHome}/4 home` : `${color} (empty seat)`}
                >
                  {player ? player.pawnsHome : ""}
                </span>
              );
            })}
          </div>
        </div>

        <div className="ludo-side">
          <div className="card-panel die-panel">
            <div className={`ludo-die${rolling ? " rolling" : ""}`} aria-live="polite">
              {view.dice !== null || view.lastRoll !== null ? (
                <DiePips value={(view.dice ?? view.lastRoll)!} />
              ) : (
                <span className="die-idle">–</span>
              )}
            </div>
            {isPlaying && !view.finished && (
              <button type="button" disabled={!isMyTurn || !view.mustRoll || rolling} onClick={() => onMove({ type: "roll" })}>
                🎲 Roll
              </button>
            )}
            {isMyTurn && !view.mustRoll && view.movablePawns.length === 0 && (
              <button type="button" onClick={() => onMove({ type: "pass" })}>
                Nothing to move — pass
              </button>
            )}
          </div>

          <div className="card-panel">
            <h3 className="hand-heading">Players</h3>
            <ul className="ludo-legend">
              {view.players.map((p) => (
                <li key={p.id} className={view.currentPlayerId === p.id ? "active" : ""}>
                  <span className={`colour-dot dot-${p.color}`} />
                  {nameOf(p.id)}
                  {p.id === playerId ? " (you)" : ""}
                  <span className="legend-count">{p.pawnsHome}/4 home</span>
                </li>
              ))}
            </ul>
          </div>

          {isPlaying && me && !view.finished && (
            <div className="card-panel">
              <h3 className="hand-heading">Your pawns</h3>
              <div className="pawn-picker">
                {me.pawns.map((pawn, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`pawn-button dot-${me.color}${movable.has(i) ? " movable" : ""}`}
                    disabled={!isMyTurn || view.mustRoll || !movable.has(i)}
                    onClick={() => onMove({ type: "movePawn", pawn: i })}
                  >
                    <span className="pawn-index">{i + 1}</span>
                    <span className="pawn-where">
                      {pawn.home
                        ? "home"
                        : pawn.inBase
                        ? "base"
                        : pawn.progress >= TRACK_LENGTH
                        ? `run ${pawn.progress - TRACK_LENGTH + 1}`
                        : `sq ${pawn.square}`}
                    </span>
                  </button>
                ))}
              </div>
              {isMyTurn && !view.mustRoll && view.movablePawns.length > 0 && (
                <p className="hint">Rolled {view.dice} — pick a highlighted pawn.</p>
              )}
            </div>
          )}

          {!isPlaying && <p className="spectator-note">👀 Spectating — Ludo hides nothing.</p>}

          {view.finished && view.finishOrder.length > 1 && (
            <div className="card-panel">
              <h3 className="hand-heading">Finishing order</h3>
              <ol className="finish-order">
                {view.finishOrder.map((id, i) => (
                  <li key={id}>
                    {i + 1}. {nameOf(id)}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
