"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listPacks, resolvePack } from "../../content/store";
import "../../content/index"; // side effect: bundled packs are available
import type { WordPack } from "../../content/types";
import {
  letterStates,
  MAX_ATTEMPTS,
  playableWords,
  scoreFor,
  scoreGuess,
  isWin,
  type Guess,
} from "./rules";

const LENGTH = 5;
const ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

/**
 * Word Hunt.
 *
 * Built on the content packs the party games already use, which is the point:
 * the Naija and Pidgin packs make this a different puzzle from every other
 * word game, and adding a pack adds puzzles without touching this file.
 */
function WordHunt() {
  const packs = useMemo(() => listPacks("words"), []);
  const [packId, setPackId] = useState(() => packs[0]?.id ?? "");
  const [answer, setAnswer] = useState("");
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);

  const words = useMemo(() => {
    if (!packId) return [];
    const pack = resolvePack<WordPack>("words", packId);
    return playableWords(pack.words, LENGTH);
  }, [packId]);

  const deal = useCallback(() => {
    if (words.length === 0) return;
    setAnswer(words[Math.floor(Math.random() * words.length)]!);
    setGuesses([]);
    setDraft("");
    setNote(null);
  }, [words]);

  useEffect(() => deal(), [deal]);

  const solved = guesses.length > 0 && isWin(guesses[guesses.length - 1]!.marks);
  const out = !solved && guesses.length >= MAX_ATTEMPTS;
  const over = solved || out;

  const submit = useCallback(() => {
    if (over || draft.length !== LENGTH) return;
    const marks = scoreGuess(draft, answer);
    const next = [...guesses, { word: draft, marks }];
    setGuesses(next);
    setDraft("");

    if (isWin(marks)) {
      const points = scoreFor(next.length);
      setScore((s) => s + points);
      setStreak((s) => s + 1);
      setNote(`Got it in ${next.length} — +${points}`);
    } else if (next.length >= MAX_ATTEMPTS) {
      setStreak(0);
      setNote(`Out of guesses. It was ${answer}.`);
    }
  }, [answer, draft, guesses, over]);

  const type = useCallback(
    (letter: string) => {
      if (over) return;
      setDraft((current) => (current.length >= LENGTH ? current : current + letter));
    },
    [over]
  );

  // A physical keyboard should just work; this is a typing game.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") return submit();
      if (e.key === "Backspace") return setDraft((d) => d.slice(0, -1));
      if (/^[a-zA-Z]$/.test(e.key)) type(e.key.toUpperCase());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, type]);

  const marksByLetter = useMemo(() => letterStates(guesses), [guesses]);
  const rows = [...guesses.map((g) => g), ...(over ? [] : [{ word: draft, marks: [] as never[] }])];

  if (words.length === 0) {
    return <p className="hint">This pack has no {LENGTH}-letter words to hunt.</p>;
  }

  return (
    <div className="word-hunt">
      <div className="hunt-head card-panel">
        <label className="hunt-pack">
          <span>Pack</span>
          <select value={packId} onChange={(e) => setPackId(e.target.value)}>
            {packs.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name}
              </option>
            ))}
          </select>
        </label>
        <span className="hunt-score">
          {score} pts{streak > 1 ? ` · 🔥${streak}` : ""}
        </span>
      </div>

      <div className="hunt-grid" aria-label="guesses">
        {Array.from({ length: MAX_ATTEMPTS }).map((_, row) => {
          const guess = rows[row];
          return (
            <div className="hunt-row" key={row}>
              {Array.from({ length: LENGTH }).map((__, col) => {
                const letter = guess?.word[col] ?? "";
                const mark = guess?.marks[col];
                return (
                  <span
                    key={col}
                    className={`hunt-cell${mark ? ` ${mark}` : ""}${letter && !mark ? " filled" : ""}`}
                    style={mark ? { animationDelay: `${col * 90}ms` } : undefined}
                  >
                    {letter}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>

      {note && <p className={`hunt-note${solved ? " win" : ""}`}>{note}</p>}

      {over ? (
        <button type="button" className="hunt-again" onClick={deal}>
          Next word
        </button>
      ) : (
        <div className="hunt-keys">
          {ROWS.map((row, i) => (
            <div className="hunt-key-row" key={i}>
              {i === 2 && (
                <button type="button" className="hunt-key wide" onClick={submit}>
                  Enter
                </button>
              )}
              {row.split("").map((letter) => (
                <button
                  key={letter}
                  type="button"
                  className={`hunt-key ${marksByLetter[letter] ?? ""}`}
                  onClick={() => type(letter)}
                >
                  {letter}
                </button>
              ))}
              {i === 2 && (
                <button
                  type="button"
                  className="hunt-key wide"
                  onClick={() => setDraft((d) => d.slice(0, -1))}
                >
                  ⌫
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { WordHunt };
