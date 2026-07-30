"use client";

import { useEffect, useState } from "react";
import type { CodewordsMove, CodewordsPlayerView } from "./module";

export interface CodewordsViewProps {
  view: CodewordsPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: CodewordsMove) => void;
}

/**
 * Code Words renderer.
 *
 * A card's colour comes from `owner`, which the server only fills in for cards
 * this recipient is entitled to see — revealed ones, or all of them if they
 * are a spymaster. There is no client-side branch here that could colour a
 * card the server left blank.
 */
export function CodewordsView({ view, playerId, isPlaying, nameOf, onMove }: CodewordsViewProps) {
  const [clue, setClue] = useState("");
  const [count, setCount] = useState(2);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((view.phaseEndsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [view.phaseEndsAt]);

  const me = view.me;
  const isSpymaster = me?.role === "spymaster";
  const myTurn = !!me && me.team === view.turn;

  function submitClue(e: React.FormEvent) {
    e.preventDefault();
    const word = clue.trim();
    if (!word) return;
    onMove({ type: "clue", word, count });
    setClue("");
  }

  const clueIsOnBoard = view.cards.some((c) => c.word.toLowerCase() === clue.trim().toLowerCase());
  const clueHasSpace = /\s/.test(clue.trim());

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            <>
              <strong className={`team-${view.winningTeam}`}>{view.winningTeam} wins</strong>
              {view.endReason === "assassin" ? " — the other side found the assassin." : " — all their words found."}
            </>
          ) : (
            <>
              <strong className={`team-${view.turn}`}>{view.turn}</strong>
              {view.phase === "clue" ? " spymaster is thinking…" : " is guessing"}
            </>
          )}
          <span className="whot-demand">
            🔴 {view.remaining.red} · 🔵 {view.remaining.blue}
          </span>
          {!view.finished && (
            <span className={`whot-debt${secondsLeft <= 10 ? " urgent" : ""}`}>{secondsLeft}s</span>
          )}
        </p>
        <span className="whot-rules-badge">
          {view.rulesName} · {view.packName}
        </span>
      </div>

      {view.clue && !view.finished && (
        <p className={`clue-banner team-${view.clue.team}`}>
          <strong>{view.clue.word}</strong>
          <span className="clue-count">{view.clue.count}</span>
          {view.guessesLeft !== null && (
            <span className="clue-left">
              {view.guessesLeft > 25 ? "unlimited guesses" : `${view.guessesLeft} guess${view.guessesLeft === 1 ? "" : "es"} left`}
            </span>
          )}
        </p>
      )}

      <div className={`codewords-grid${isSpymaster ? " spymaster" : ""}`}>
        {view.cards.map((card, i) => {
          const selectable = view.canAct && view.phase === "guess" && !card.revealed && isPlaying;
          return (
            <button
              key={card.word}
              type="button"
              className={[
                "codeword-card",
                card.owner ? `owner-${card.owner}` : "owner-unknown",
                card.revealed ? "revealed" : "",
                selectable ? "selectable" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={!selectable}
              onClick={() => onMove({ type: "guess", cardIndex: i })}
            >
              <span className="codeword-text">{card.word}</span>
              {card.revealed && <span className="codeword-mark">{card.owner === "assassin" ? "☠" : "✓"}</span>}
            </button>
          );
        })}
      </div>

      {isSpymaster && !view.finished && (
        <p className="hint spymaster-note">
          🔑 You can see the key. Say one word and a number — nothing else.
        </p>
      )}

      {isPlaying && myTurn && view.phase === "clue" && isSpymaster && !view.finished && (
        <form className="card-panel clue-form" onSubmit={submitClue}>
          <label>
            <span>Your clue</span>
            <input
              value={clue}
              maxLength={24}
              placeholder="one word"
              onChange={(e) => setClue(e.target.value)}
            />
          </label>
          <label>
            <span>For</span>
            <input
              type="number"
              min={0}
              max={9}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <button type="submit" disabled={!clue.trim() || clueHasSpace || clueIsOnBoard}>
            Give clue
          </button>
          {clueHasSpace && <p className="error-note">One word only.</p>}
          {clueIsOnBoard && <p className="error-note">That word is on the table.</p>}
        </form>
      )}

      {isPlaying && myTurn && view.phase === "guess" && !isSpymaster && !view.finished && (
        <div className="table-actions">
          <button type="button" onClick={() => onMove({ type: "endTurn" })}>
            Stop guessing
          </button>
        </div>
      )}

      {isPlaying && !myTurn && !view.finished && (
        <p className="hint">Waiting on the other team.</p>
      )}
      {!isPlaying && <p className="spectator-note">👀 Spectating — the key stays hidden until the end.</p>}

      <div className="card-panel team-panel">
        {(["red", "blue"] as const).map((team) => (
          <div key={team} className={`team-column team-${team}`}>
            <h3>
              {team} · {view.remaining[team]} left
            </h3>
            <ul>
              {view.players
                .filter((p) => p.team === team)
                .map((p) => (
                  <li key={p.id} className={p.id === playerId ? "me" : ""}>
                    {p.role === "spymaster" ? "🔑 " : ""}
                    {nameOf(p.id)}
                    {p.id === playerId ? " (you)" : ""}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>

      {view.history.length > 0 && (
        <div className="card-panel">
          <h3 className="hand-heading">Clues so far</h3>
          <ol className="clue-history">
            {view.history.map((c, i) => (
              <li key={i} className={`team-${c.team}`}>
                <strong>{c.word}</strong> {c.count} — {nameOf(c.by)}
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
