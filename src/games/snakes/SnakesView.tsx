"use client";

import { useEffect, useRef, useState } from "react";
import { useFlipGroup } from "../../ui/motion";
import type { SnakesMove, SnakesPlayerView } from "./module";

export interface SnakesViewProps {
  view: SnakesPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: SnakesMove) => void;
}

const COLOURS = ["red", "green", "yellow", "blue"] as const;

/** Snake and ladder artwork colours, cycled so neighbours differ. */
const SNAKE_COLOURS = ["#e94b3c", "#f2b01e", "#7ac143", "#4bb3e6", "#b565d8", "#ef7fa8"];
const LADDER_COLOUR = "#cfe4ef";
const LADDER_EDGE = "#7fa9bd";

/**
 * Board squares run boustrophedon: 1 is bottom-left, numbering snakes back
 * and forth up the grid so 100 lands top-left. Returns 1-indexed grid
 * coordinates.
 */
function squarePosition(square: number): { col: number; row: number } {
  const index = square - 1;
  const rowFromBottom = Math.floor(index / 10);
  const withinRow = index % 10;
  const col = rowFromBottom % 2 === 0 ? withinRow : 9 - withinRow;
  return { col: col + 1, row: 10 - rowFromBottom };
}

/** Centre of a square in SVG units, where the whole board is 100×100. */
function squareCentre(square: number): { x: number; y: number } {
  const { col, row } = squarePosition(square);
  return { x: col * 10 - 5, y: row * 10 - 5 };
}

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

/** A ladder drawn as two rails with rungs, from base square to top square. */
function Ladder({ from, to }: { from: number; to: number }) {
  const a = squareCentre(from);
  const b = squareCentre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  // Unit vector perpendicular to the ladder, for rail offset and rung ends.
  const px = (-dy / length) * 1.9;
  const py = (dx / length) * 1.9;

  const rungs = Math.max(2, Math.round(length / 4.5));
  const lines = [];
  for (let i = 1; i < rungs; i++) {
    const t = i / rungs;
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    lines.push(
      <line key={i} x1={cx - px} y1={cy - py} x2={cx + px} y2={cy + py} stroke={LADDER_EDGE} strokeWidth={0.8} />
    );
  }

  return (
    <g>
      <line x1={a.x - px} y1={a.y - py} x2={b.x - px} y2={b.y - py} stroke={LADDER_COLOUR} strokeWidth={1.5} strokeLinecap="round" />
      <line x1={a.x + px} y1={a.y + py} x2={b.x + px} y2={b.y + py} stroke={LADDER_COLOUR} strokeWidth={1.5} strokeLinecap="round" />
      {lines}
    </g>
  );
}

/** A snake drawn as a curved body from head (high square) to tail (low). */
function Snake({ from, to, colour }: { from: number; to: number; colour: string }) {
  const head = squareCentre(from);
  const tail = squareCentre(to);
  const dx = tail.x - head.x;
  const dy = tail.y - head.y;
  const length = Math.hypot(dx, dy) || 1;
  // Bow the body out to one side so it reads as a snake, not a pipe.
  const bow = Math.min(14, length * 0.35);
  const nx = (-dy / length) * bow;
  const ny = (dx / length) * bow;
  const mid = { x: (head.x + tail.x) / 2, y: (head.y + tail.y) / 2 };

  const path = `M ${head.x} ${head.y} Q ${mid.x + nx} ${mid.y + ny} ${tail.x} ${tail.y}`;

  return (
    <g>
      <path d={path} fill="none" stroke="#00000033" strokeWidth={3.4} strokeLinecap="round" />
      <path d={path} fill="none" stroke={colour} strokeWidth={2.6} strokeLinecap="round" />
      {/* Head sits on the high square, which is where you get bitten. */}
      <circle cx={head.x} cy={head.y} r={2.2} fill={colour} stroke="#00000055" strokeWidth={0.4} />
      <circle cx={head.x - 0.8} cy={head.y - 0.6} r={0.42} fill="#fff" />
      <circle cx={head.x + 0.8} cy={head.y - 0.6} r={0.42} fill="#fff" />
    </g>
  );
}

export function SnakesView({ view, playerId, isMyTurn, isPlaying, nameOf, onMove }: SnakesViewProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  // Tokens slide up the board between squares instead of blinking to the new
  // one, so a roll of five reads as movement rather than a redraw.
  useFlipGroup(boardRef, view.players.map((p) => `${p.id}:${p.square}`).join("|"), { duration: 420 });
  const [rolling, setRolling] = useState(false);
  const lastRollCount = useRef(view.rollCount);

  useEffect(() => {
    if (view.rollCount === lastRollCount.current) return;
    lastRollCount.current = view.rollCount;
    setRolling(true);
    const timer = setTimeout(() => setRolling(false), 550);
    return () => clearTimeout(timer);
  }, [view.rollCount]);

  const colourOf = (id: string) => COLOURS[view.players.findIndex((p) => p.id === id) % COLOURS.length];

  const bySquare = new Map<number, string[]>();
  for (const p of view.players) {
    if (p.square < 1) continue;
    const list = bySquare.get(p.square) ?? [];
    list.push(p.id);
    bySquare.set(p.square, list);
  }

  /**
   * Tokens that have not yet entered the board.
   *
   * Without this they were rendered nowhere at all, so before anyone's first
   * roll the board looked completely empty — as though the game were dead.
   */
  const waiting = view.players.filter((p) => p.square < 1);
  const move = view.lastMove;

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            <>Race over — {nameOf(view.winners[0] ?? "")} reaches 100.</>
          ) : isMyTurn ? (
            <strong>Your turn — roll.</strong>
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

      {move && (
        <p className={`snakes-event snakes-${move.kind}`}>
          {move.kind === "ladder" && `🪜 ${nameOf(move.playerId)} climbed ${move.steppedTo} → ${move.finalSquare}`}
          {move.kind === "snake" && `🐍 ${nameOf(move.playerId)} slid ${move.steppedTo} → ${move.finalSquare}`}
          {move.kind === "blocked" &&
            `${nameOf(move.playerId)} overshot — needs exactly ${view.boardSize - move.from} to finish`}
          {move.kind === "move" && `${nameOf(move.playerId)} moved ${move.from} → ${move.finalSquare}`}
        </p>
      )}

      <div className="ludo-layout">
        <div className="snakes-board-wrap">
          <div ref={boardRef} className="snakes-board">
            {Array.from({ length: view.boardSize }, (_, i) => {
              const square = i + 1;
              const { col, row } = squarePosition(square);
              const tokens = bySquare.get(square) ?? [];
              // Checkerboard, matching a printed board.
              const shaded = (col + row) % 2 === 0;
              return (
                <div
                  key={square}
                  className={`snake-cell${shaded ? " shaded" : ""}${square === view.boardSize ? " finish" : ""}`}
                  style={{ gridColumn: col, gridRow: row }}
                  title={
                    view.ladders[square]
                      ? `Ladder ${square} → ${view.ladders[square]}`
                      : view.snakes[square]
                      ? `Snake ${square} → ${view.snakes[square]}`
                      : `Square ${square}`
                  }
                >
                  <span className="cell-number">{square === view.boardSize ? "🏆100" : square}</span>
                  {tokens.length > 0 && (
                    <span className="cell-tokens">
                      {tokens.map((id) => (
                        <span
                          key={id}
                          data-flip={id}
                          className={`token dot-${colourOf(id)}`}
                          title={nameOf(id)}
                        />
                      ))}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Snakes and ladders drawn over the grid, spanning their squares. */}
            <svg className="snakes-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {Object.entries(view.ladders).map(([from, to]) => (
                <Ladder key={`l${from}`} from={Number(from)} to={to} />
              ))}
              {Object.entries(view.snakes).map(([from, to], i) => (
                <Snake key={`s${from}`} from={Number(from)} to={to} colour={SNAKE_COLOURS[i % SNAKE_COLOURS.length]!} />
              ))}
            </svg>
          </div>

          {/* Pieces waiting to enter, so they are never invisible. */}
          <div className="snakes-start">
            <span className="start-label">Start</span>
            {waiting.length === 0 ? (
              <span className="start-empty">everyone&apos;s on the board</span>
            ) : (
              waiting.map((p) => (
                <span key={p.id} className="start-token">
                  <span className={`token dot-${colourOf(p.id)}`} />
                  {nameOf(p.id)}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="ludo-side">
          <div className="card-panel die-panel">
            <div className={`ludo-die${rolling ? " rolling" : ""}`} aria-live="polite">
              {view.lastRoll !== null ? <DiePips value={view.lastRoll} /> : <span className="die-idle">–</span>}
            </div>
            {isPlaying && !view.finished && (
              <button type="button" disabled={!isMyTurn || !view.mustRoll || rolling} onClick={() => onMove({ type: "roll" })}>
                🎲 Roll
              </button>
            )}
            {view.requireExactFinish && <p className="hint">Exact roll needed to land on {view.boardSize}.</p>}
          </div>

          <div className="card-panel">
            <h3 className="hand-heading">Positions</h3>
            <ul className="ludo-legend">
              {[...view.players]
                .sort((a, b) => b.square - a.square)
                .map((p) => (
                  <li key={p.id} className={view.currentPlayerId === p.id ? "active" : ""}>
                    <span className={`colour-dot dot-${colourOf(p.id)}`} />
                    {nameOf(p.id)}
                    {p.id === playerId ? " (you)" : ""}
                    <span className="legend-count">
                      {p.finished ? "🏆 home" : p.square < 1 ? "start" : `sq ${p.square}`}
                    </span>
                  </li>
                ))}
            </ul>
          </div>

          {!isPlaying && <p className="spectator-note">👀 Spectating — nothing is hidden here.</p>}

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
