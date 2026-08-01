"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Movement.
 *
 * Every game here renders from a server snapshot, so a move arrives as a new
 * position with no memory of the old one and the piece simply appears there.
 * That reads as a glitch rather than a move: you cannot see WHAT happened, only
 * that something did.
 *
 * The fix is FLIP — measure where things were, let React paint where they now
 * are, then transform them back and animate to zero. It runs on the compositor
 * (transform and opacity only), needs no layout thrash, and works for any
 * element that carries a stable `data-flip` id, so a game opts in by labelling
 * its pieces rather than by writing animation code.
 */

/** Honours the OS setting. Motion sickness is not a preference to override. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const EASE_OUT = "cubic-bezier(0.22, 0.61, 0.36, 1)";
/** Slight overshoot — the settle that makes a piece feel like an object. */
export const EASE_SETTLE = "cubic-bezier(0.34, 1.36, 0.64, 1)";

export interface FlipOptions {
  /** Ms for a piece to travel. */
  duration?: number;
  /** Ms for a newly appearing piece to fade in. */
  enterDuration?: number;
  easing?: string;
  /** Animate elements that appear for the first time. */
  animateEnter?: boolean;
}

/**
 * Animates every `[data-flip]` inside `root` whenever `key` changes.
 *
 * `key` should be a cheap string describing the arrangement — the thing that
 * changes when pieces move. Positions are captured after every commit, so a
 * re-render that moves nothing costs two measurements and no animation.
 */
export function useFlipGroup(
  root: RefObject<HTMLElement | null>,
  key: string,
  options: FlipOptions = {}
): void {
  const { duration = 380, enterDuration = 220, easing = EASE_OUT, animateEnter = true } = options;
  const previous = useRef(new Map<string, DOMRect>());
  const first = useRef(true);

  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;

    const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-flip]"));
    const next = new Map<string, DOMRect>();
    const reduced = prefersReducedMotion();

    for (const node of nodes) {
      const id = node.dataset.flip;
      if (!id) continue;
      const rect = node.getBoundingClientRect();
      next.set(id, rect);
      if (reduced || first.current) continue;

      const before = previous.current.get(id);
      if (!before) {
        // A piece that was not there a moment ago: dealt, drawn, spawned.
        if (animateEnter && rect.width > 0) {
          node.animate(
            [
              { opacity: 0, transform: "scale(0.86) translateY(10px)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: enterDuration, easing, fill: "none" }
          );
        }
        continue;
      }

      const dx = before.left - rect.left;
      const dy = before.top - rect.top;
      const scale = before.width > 0 && rect.width > 0 ? before.width / rect.width : 1;
      // Sub-pixel drift from a reflow is not a move; animating it would make
      // the whole board shiver on every unrelated update.
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.02) continue;

      node.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
          { transform: "translate(0, 0) scale(1)" },
        ],
        { duration, easing, fill: "none" }
      );
    }

    previous.current = next;
    first.current = false;
  }, [key, root, duration, enterDuration, easing, animateEnter]);
}

/**
 * Walks an element through a series of points instead of sliding it straight
 * there.
 *
 * A token that moves six squares should visibly count six squares — that is
 * the difference between "the server said 6" and watching a piece travel. The
 * offsets are relative to where the element already sits, so the caller works
 * in board coordinates and never has to know about layout.
 */
export function travelAlong(
  node: HTMLElement | null,
  offsets: Array<{ x: number; y: number }>,
  msPerStep = 130
): Animation | null {
  if (!node || offsets.length === 0 || prefersReducedMotion()) return null;

  const frames = offsets.map((offset, i) => ({
    transform: `translate(${offset.x}px, ${offset.y}px)`,
    // A small lift at the middle of each hop reads as a step rather than a
    // slide. Held flat on the last frame so the piece lands.
    offset: offsets.length === 1 ? 1 : i / (offsets.length - 1),
    easing: i === offsets.length - 1 ? EASE_SETTLE : "ease-in-out",
  }));

  return node.animate(frames, {
    duration: Math.max(msPerStep, msPerStep * offsets.length),
    fill: "none",
  });
}

/**
 * Slides the piece that just moved out of the square it came from.
 *
 * Chess and draughts render their boards from an array of squares, so a piece
 * has no identity that survives a move — the old square simply empties and the
 * new one fills, which is why a move used to appear as a blink with no sense
 * of a hand moving anything. Both games do publish the move itself, so the
 * animation is driven from that instead: put the arriving piece back where it
 * started, then let it travel.
 *
 * Squares must carry `data-square`, and the piece must be the square's child.
 */
export function useSquareSlide(
  root: RefObject<HTMLElement | null>,
  from: string | null | undefined,
  to: string | null | undefined,
  key: string,
  duration = 260
): void {
  useEffect(() => {
    const container = root.current;
    if (!container || !from || !to || from === to || prefersReducedMotion()) return;

    const fromEl = container.querySelector<HTMLElement>(`[data-square="${CSS.escape(from)}"]`);
    const toEl = container.querySelector<HTMLElement>(`[data-square="${CSS.escape(to)}"]`);
    const piece = toEl?.firstElementChild as HTMLElement | null;
    if (!fromEl || !toEl || !piece) return;

    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    piece.animate(
      [
        { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)`, zIndex: 5 },
        { transform: "translate(0, 0)", zIndex: 5 },
      ],
      { duration, easing: EASE_OUT, fill: "none" }
    );
  }, [root, from, to, key, duration]);
}

/**
 * Runs `effect` when `value` changes, giving it the previous value.
 *
 * Most of the animation triggers here are "this differs from last time" —
 * a new dice roll, a new card on the pile, a piece that moved.
 */
export function useChange<T>(value: T, effect: (previous: T, current: T) => void): void {
  const previous = useRef(value);
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    const before = previous.current;
    previous.current = value;
    effect(before, value);
  }, [value, effect]);
}

/**
 * Adds a class for the length of an animation, then takes it off.
 *
 * Lets a CSS keyframe be re-triggered on demand: the class going away and
 * coming back is what restarts it.
 */
export function pulse(node: HTMLElement | null, className: string, ms: number): void {
  if (!node || prefersReducedMotion()) return;
  node.classList.remove(className);
  // Forces a reflow so the browser treats the next add as a fresh start.
  void node.offsetWidth;
  node.classList.add(className);
  window.setTimeout(() => node.classList.remove(className), ms);
}
