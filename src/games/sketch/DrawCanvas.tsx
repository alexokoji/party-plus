"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The shared canvas.
 *
 * Strokes travel as small deltas on the room's ephemeral channel rather than
 * as moves: a pointer trail is dozens of points a second, and every one of
 * those going through game state would mean a state write and a full snapshot
 * broadcast per point. Nothing here is authoritative — the canvas is a picture,
 * and the only thing that decides the round is the guess check on the server.
 *
 * Coordinates are normalised to 0–1 so a phone and a laptop draw the same
 * picture at different sizes.
 */

export type StrokeFrame =
  | { k: "s"; x: number; y: number; c: string; w: number }
  | { k: "m"; x: number; y: number }
  | { k: "e" }
  | { k: "clear" }
  | { k: "undo" }
  /** Full replay, sent to catch up anyone who joined or reloaded mid-drawing. */
  | { k: "sync"; strokes: Stroke[] };

export interface Stroke {
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
}

export interface DrawCanvasProps {
  /** True when this client owns the pen. */
  canDraw: boolean;
  /** Sends a frame to the rest of the room. */
  onFrame: (frame: StrokeFrame) => void;
  /** Subscribes to frames from the drawer. */
  subscribe: (handler: (frame: StrokeFrame) => void) => () => void;
  /** Bumping this clears the canvas — a new turn, a new drawing. */
  turnKey: string;
}

const COLORS = ["#101418", "#d92e2e", "#1f7ae0", "#2fa84f", "#f0a500", "#8e44ad", "#8b5a2b", "#ffffff"];
const WIDTHS = [2, 6, 14, 28];

export function DrawCanvas({ canDraw, onFrame, subscribe, turnKey }: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  const [color, setColor] = useState(COLORS[0]!);
  const [width, setWidth] = useState(WIDTHS[1]!);

  /** Repaints everything. Cheap enough at party-game stroke counts. */
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width: w, height: h } = canvas;
    ctx.fillStyle = "#fdfcf7";
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokesRef.current) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width * (w / 1000);
      ctx.beginPath();
      ctx.moveTo(stroke.points[0]!.x * w, stroke.points[0]!.y * h);
      for (const p of stroke.points.slice(1)) ctx.lineTo(p.x * w, p.y * h);
      // A single tap should leave a dot, not nothing.
      if (stroke.points.length === 1) ctx.lineTo(stroke.points[0]!.x * w + 0.01, stroke.points[0]!.y * h);
      ctx.stroke();
    }
  }, []);

  /** Applies one frame — from the network, or from our own pointer. */
  const applyFrame = useCallback(
    (frame: StrokeFrame) => {
      const strokes = strokesRef.current;
      switch (frame.k) {
        case "s":
          strokes.push({ color: frame.c, width: frame.w, points: [{ x: frame.x, y: frame.y }] });
          break;
        case "m":
          strokes[strokes.length - 1]?.points.push({ x: frame.x, y: frame.y });
          break;
        case "e":
          break;
        case "clear":
          strokesRef.current = [];
          break;
        case "undo":
          strokes.pop();
          break;
        case "sync":
          strokesRef.current = frame.strokes;
          break;
      }
      repaint();
    },
    [repaint]
  );

  // A new turn starts on a blank canvas for everyone.
  useEffect(() => {
    strokesRef.current = [];
    repaint();
  }, [turnKey, repaint]);

  useEffect(() => subscribe(applyFrame), [subscribe, applyFrame]);

  // Size the backing store to the element so lines are not blurry.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      repaint();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [repaint]);

  function positionOf(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function send(frame: StrokeFrame) {
    applyFrame(frame);
    onFrame(frame);
  }

  return (
    <div className="sketch-canvas-wrap">
      <canvas
        ref={canvasRef}
        className={`sketch-canvas${canDraw ? " drawable" : ""}`}
        onPointerDown={(e) => {
          if (!canDraw) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawingRef.current = true;
          const { x, y } = positionOf(e);
          send({ k: "s", x, y, c: color, w: width });
        }}
        onPointerMove={(e) => {
          if (!canDraw || !drawingRef.current) return;
          const { x, y } = positionOf(e);
          send({ k: "m", x, y });
        }}
        onPointerUp={() => {
          if (!canDraw || !drawingRef.current) return;
          drawingRef.current = false;
          send({ k: "e" });
        }}
        onPointerLeave={() => {
          if (drawingRef.current) {
            drawingRef.current = false;
            send({ k: "e" });
          }
        }}
      />

      {canDraw && (
        <div className="sketch-tools">
          <div className="sketch-colors">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`colour ${c}`}
                className={`swatch${color === c ? " active" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <div className="sketch-widths">
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                aria-label={`brush ${w}`}
                className={`brush${width === w ? " active" : ""}`}
                onClick={() => setWidth(w)}
              >
                <span style={{ width: w / 2 + 4, height: w / 2 + 4 }} />
              </button>
            ))}
          </div>
          <div className="sketch-actions">
            <button type="button" onClick={() => send({ k: "undo" })}>
              ↶ Undo
            </button>
            <button type="button" onClick={() => send({ k: "clear" })}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { COLORS as SKETCH_COLORS, WIDTHS as SKETCH_WIDTHS };
