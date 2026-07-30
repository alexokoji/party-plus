"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DrawCanvas, type StrokeFrame } from "./DrawCanvas";
import type { SketchMove, SketchPlayerView } from "./module";

export interface SketchViewProps {
  view: SketchPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: SketchMove) => void;
  /** Ephemeral channel, supplied by the room shell. */
  sendStream: (channel: string, data: unknown) => void;
  onStream: (handler: (frame: { from: string; channel: string; data: unknown }) => void) => () => void;
}

/**
 * Sketch & Guess renderer.
 *
 * Guessers get `wordMask` and never the word, so the hint line here is drawn
 * from what the server chose to send. Guesses go through the normal move
 * channel and are checked on the server; only the strokes use the fast path.
 */
export function SketchView({
  view,
  playerId,
  isPlaying,
  nameOf,
  onMove,
  sendStream,
  onStream,
}: SketchViewProps) {
  const [guess, setGuess] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const feedRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((view.phaseEndsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [view.phaseEndsAt]);

  // Scroll the guess list itself, never the page.
  useEffect(() => {
    const box = feedRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [view.guesses.length]);

  const sendFrame = useCallback((frame: StrokeFrame) => sendStream("draw", frame), [sendStream]);

  const subscribe = useCallback(
    (handler: (frame: StrokeFrame) => void) =>
      onStream((frame) => {
        if (frame.channel === "draw") handler(frame.data as StrokeFrame);
      }),
    [onStream]
  );

  function submitGuess(e: React.FormEvent) {
    e.preventDefault();
    const text = guess.trim();
    if (!text) return;
    onMove({ type: "guess", text });
    setGuess("");
  }

  const drawerName = view.drawerId ? nameOf(view.drawerId) : "";

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            <>Match over — {view.winners.map(nameOf).join(", ")} on top.</>
          ) : view.phase === "choosing" ? (
            <>
              <strong>{drawerName}</strong> is choosing a word…
            </>
          ) : view.phase === "drawing" ? (
            view.iAmDrawing ? (
              <strong>You&apos;re drawing!</strong>
            ) : (
              <>
                <strong>{drawerName}</strong> is drawing
              </>
            )
          ) : (
            <>Round over — the word was <strong>{view.word}</strong></>
          )}
          <span className="whot-demand">
            round {Math.min(view.round, view.roundTotal)} of {view.roundTotal}
          </span>
          {!view.finished && (
            <span className={`whot-debt${secondsLeft <= 10 ? " urgent" : ""}`}>{secondsLeft}s</span>
          )}
        </p>
        <span className="whot-rules-badge">
          {view.rulesName} · {view.packName}
        </span>
      </div>

      {/* The word line: the actual word for the drawer, a mask for everyone else. */}
      {view.phase === "drawing" && (
        <p className="sketch-word">
          {view.iAmDrawing ? (
            <>
              Draw: <strong>{view.word}</strong>
            </>
          ) : view.iSolved ? (
            <>✓ You got it — sit tight.</>
          ) : (
            <span className="word-mask">{view.wordMask}</span>
          )}
        </p>
      )}

      {view.canChoose && view.choices && (
        <div className="card-panel shape-chooser">
          <p>Pick something to draw:</p>
          <div className="shape-buttons">
            {view.choices.map((word, i) => (
              <button key={word} type="button" onClick={() => onMove({ type: "chooseWord", index: i })}>
                {word}
              </button>
            ))}
          </div>
          <button type="button" className="ghost" onClick={() => onMove({ type: "skipTurn" })}>
            Skip my turn
          </button>
        </div>
      )}

      <DrawCanvas
        canDraw={view.iAmDrawing && view.phase === "drawing"}
        onFrame={sendFrame}
        subscribe={subscribe}
        turnKey={`${view.round}:${view.drawerId ?? ""}`}
      />

      <div className="sketch-lower">
        <div className="card-panel sketch-guesses">
          <h3 className="hand-heading">Guesses</h3>
          <ol className="guess-feed" ref={feedRef}>
            {view.guesses.map((g, i) => (
              <li key={i} className={g.correct ? "correct" : g.close ? "close" : ""}>
                <strong>{nameOf(g.playerId)}</strong>{" "}
                {g.correct ? (
                  <em>guessed it! +{g.points}</em>
                ) : (
                  <>
                    {g.text}
                    {g.close && <em> — close!</em>}
                  </>
                )}
              </li>
            ))}
            {view.guesses.length === 0 && <li className="hint">No guesses yet.</li>}
          </ol>

          {isPlaying && view.canGuess && (
            <form className="guess-form" onSubmit={submitGuess}>
              <input
                value={guess}
                maxLength={64}
                placeholder="Type your guess…"
                onChange={(e) => setGuess(e.target.value)}
              />
              <button type="submit" disabled={!guess.trim()}>
                Guess
              </button>
            </form>
          )}
          {isPlaying && view.iAmDrawing && <p className="hint">No clues in the chat — draw it.</p>}
          {!isPlaying && <p className="spectator-note">👀 Spectating — the word stays hidden.</p>}
        </div>

        <div className="card-panel sketch-scores">
          <h3 className="hand-heading">Scores</h3>
          <ul className="score-list">
            {view.scores.map((row) => (
              <li key={row.playerId} className={row.playerId === playerId ? "me" : ""}>
                <span>
                  {row.playerId === view.drawerId ? "✏️ " : ""}
                  {nameOf(row.playerId)}
                  {row.playerId === playerId ? " (you)" : ""}
                </span>
                <span className="score-value">
                  {row.score}
                  {row.solvedThisTurn && <span className="solved-tick"> ✓</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {view.finished && view.past.length > 0 && (
        <div className="card-panel">
          <h3 className="hand-heading">Every word</h3>
          <ul className="all-hands">
            {view.past.map((t, i) => (
              <li key={i}>
                <strong>{t.word}</strong>
                <span>
                  by {nameOf(t.drawerId)} · {t.solvedBy.length} got it
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
