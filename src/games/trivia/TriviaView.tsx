"use client";

import { useEffect, useRef, useState } from "react";
import type { TriviaMove, TriviaPlayerView } from "./module";

export interface TriviaViewProps {
  view: TriviaPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: TriviaMove) => void;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * Trivia renderer.
 *
 * `reveal` is null while a question is open, so there is nothing here that
 * could highlight the right answer early — the correct option only gets a
 * class once the server has closed the question and sent the key.
 */
export function TriviaView({ view, playerId, isPlaying, nameOf, onMove }: TriviaViewProps) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  // The full length of the current phase, captured when it starts, so the bar
  // has something to be a fraction of.
  const maxRef = useRef(1);
  const phaseKey = `${view.phase}:${view.questionNumber}`;
  // Starts as a sentinel no phase can equal, so the very first render captures
  // the length too — seeding it with phaseKey left the max at 1 and the bar at
  // 1900%.
  const lastPhase = useRef("");
  if (lastPhase.current !== phaseKey) {
    lastPhase.current = phaseKey;
    maxRef.current = Math.max(1, Math.ceil((view.phaseEndsAt - Date.now()) / 1000));
  }
  const maxSeconds = maxRef.current;

  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((view.phaseEndsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [view.phaseEndsAt]);

  const reveal = view.reveal;
  const answered = view.myAnswer !== null;

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            <>
              Final scores — {view.winners.map(nameOf).join(", ")}
              {view.winners.length > 1 ? " tie it" : " wins"}.
            </>
          ) : (
            <>
              Question <strong>{view.questionNumber}</strong> of {view.questionTotal}
            </>
          )}
          <span className="whot-demand">
            {view.answeredCount}/{view.playerCount} answered
          </span>
          {!view.finished && (
            <span className={`whot-debt${secondsLeft <= 5 ? " urgent" : ""}`}>{secondsLeft}s</span>
          )}
        </p>
        <span className="whot-rules-badge">
          {view.rulesName} · {view.packName}
        </span>
      </div>

      {view.question && !view.finished && (
        <div className="card-panel trivia-question">
          {view.question.category && <span className="trivia-category">{view.question.category}</span>}
          <h2>{view.question.text}</h2>

          {view.phase === "question" && (
            <div className="trivia-timer-track">
              {/* Purely decorative: the server owns the real deadline. */}
              <div className="trivia-timer" style={{ width: `${(secondsLeft / maxSeconds) * 100}%` }} />
            </div>
          )}

          <div className="trivia-options">
            {view.question.options.map((option, i) => {
              const isMine = view.myAnswer === i;
              const isCorrect = reveal ? reveal.correctIndex === i : false;
              const isWrongPick = !!reveal && isMine && !isCorrect;
              return (
                <button
                  key={option}
                  type="button"
                  className={[
                    "trivia-option",
                    isMine ? "mine" : "",
                    reveal && isCorrect ? "correct" : "",
                    isWrongPick ? "wrong" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={!isPlaying || !view.canAnswer}
                  onClick={() => onMove({ type: "answer", optionIndex: i })}
                >
                  <span className="option-letter">{LETTERS[i]}</span>
                  <span className="option-text">{option}</span>
                  {reveal && <span className="option-count">{reveal.counts[i] ?? 0}</span>}
                </button>
              );
            })}
          </div>

          {reveal?.note && <p className="trivia-note">{reveal.note}</p>}
          {view.phase === "question" && answered && (
            <p className="hint">Locked in. Waiting for the rest…</p>
          )}
          {view.phase === "question" && isPlaying && !answered && (
            <button type="button" className="ghost" onClick={() => onMove({ type: "skip" })}>
              Pass
            </button>
          )}
          {!isPlaying && <p className="spectator-note">👀 Spectating — you can watch the scores.</p>}
        </div>
      )}

      <div className="card-panel">
        <h3 className="hand-heading">{view.finished ? "Final leaderboard" : "Leaderboard"}</h3>
        <ol className="leaderboard">
          {view.leaderboard.map((row, i) => (
            <li key={row.playerId} className={row.playerId === playerId ? "me" : ""}>
              <span className="rank">{i + 1}</span>
              <span className="who">
                {nameOf(row.playerId)}
                {row.playerId === playerId ? " (you)" : ""}
                {row.streak >= 2 && <span className="streak"> 🔥{row.streak}</span>}
              </span>
              {row.lastAnswerCorrect !== null && (
                <span className={row.lastAnswerCorrect ? "delta up" : "delta down"}>
                  {row.lastAnswerCorrect ? `+${row.lastPoints}` : row.lastPoints < 0 ? row.lastPoints : "—"}
                </span>
              )}
              <span className="score-value">{row.score}</span>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
