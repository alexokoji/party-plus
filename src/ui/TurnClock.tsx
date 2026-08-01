"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion";

export interface TurnClockProps {
  /** Epoch ms the current turn or phase ends. */
  deadline: number;
  /** True when the person looking at it is the one holding everybody up. */
  isMyTurn: boolean;
  /** Who is on the clock, already resolved to a name. */
  who: string;
  /** Shown under the number, e.g. "or you forfeit the turn". */
  note?: string;
}

/**
 * The turn clock.
 *
 * It used to be a thin line of text above the board, which is fine for the
 * player whose turn it is and useless for everyone else — in a party game the
 * whole table is watching one screen or four, and the question "how long have
 * I got" has to be answerable from across a room.
 *
 * So: a large ring, a large number, and sticky to the top of the game area so
 * it survives scrolling. The ring drains smoothly on its own rather than
 * stepping once a second, because a smooth sweep is legible at a glance while
 * a jumping number is not.
 */
export function TurnClock({ deadline, isMyTurn, who, note }: TurnClockProps) {
  const [now, setNow] = useState(() => Date.now());
  // The full length of this turn, captured when the deadline changes, so the
  // ring has something to be a fraction of.
  const totalRef = useRef(1);
  const lastDeadline = useRef(0);

  if (lastDeadline.current !== deadline) {
    lastDeadline.current = deadline;
    totalRef.current = Math.max(1000, deadline - Date.now());
  }

  /**
   * An interval drives the clock, not a frame loop.
   *
   * requestAnimationFrame stops entirely in a tab that is not being composited
   * — backgrounded, occluded, or on a phone with the screen off — so a clock
   * built on it freezes and then jumps when you look back. An interval keeps
   * running (throttled, but running), and the smoothness that rAF would have
   * bought is done in CSS instead, by transitioning the ring between values.
   *
   * Four updates a second is more than enough for a number that counts in
   * seconds, and costs nothing next to a frame loop.
   */
  useEffect(() => {
    setNow(Date.now());
    const period = prefersReducedMotion() ? 1000 : 250;
    const id = window.setInterval(() => setNow(Date.now()), period);
    return () => window.clearInterval(id);
  }, [deadline]);

  const msLeft = Math.max(0, deadline - now);
  const seconds = Math.ceil(msLeft / 1000);
  const fraction = Math.max(0, Math.min(1, msLeft / totalRef.current));

  const urgent = seconds <= 5;
  const warning = !urgent && seconds <= 10;

  // 44px radius circle: circumference for the dash offset.
  const R = 44;
  const CIRC = 2 * Math.PI * R;

  return (
    <div
      className={`turn-clock-panel${isMyTurn ? " mine" : ""}${urgent ? " urgent" : warning ? " warning" : ""}`}
      role="timer"
      aria-live="off"
      aria-label={`${seconds} seconds left`}
    >
      <div className="clock-ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="ring-track" cx="50" cy="50" r={R} />
          <circle
            className="ring-progress"
            cx="50"
            cy="50"
            r={R}
            style={{ strokeDasharray: CIRC, strokeDashoffset: CIRC * (1 - fraction) }}
          />
        </svg>
        <span className="clock-seconds">{seconds}</span>
      </div>

      <div className="clock-copy">
        <strong className="clock-who">{isMyTurn ? "Your turn" : `${who} to play`}</strong>
        {note && <span className="clock-note">{note}</span>}
      </div>
    </div>
  );
}
