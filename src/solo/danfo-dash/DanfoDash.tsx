"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createDash, LANES, moveLane, PLAYER_Y, step, type DashState } from "./engine";

const BEST_KEY = "games-dome.danfo-dash.best";

/**
 * Danfo Dash.
 *
 * The whole simulation lives in engine.ts as a pure step function; this draws
 * it and collects input. Keeping them apart is what lets the difficulty curve
 * and the collision test be unit-tested in milliseconds instead of played.
 *
 * Nothing here talks to a server, which is the point of the solo category: it
 * costs nothing to serve and starts instantly.
 */
function DanfoDash() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<DashState>(createDash());
  const rafRef = useRef(0);
  const lastRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [crashed, setCrashed] = useState(false);

  useEffect(() => {
    try {
      setBest(Number(window.localStorage.getItem(BEST_KEY) ?? 0));
    } catch {
      /* storage disabled; the run still counts, it just is not remembered */
    }
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width: w, height: h } = canvas;
    const state = stateRef.current;

    // Road
    ctx.fillStyle = "#22262e";
    ctx.fillRect(0, 0, w, h);

    // Lane markings, scrolling to sell the speed.
    ctx.strokeStyle = "#4a5160";
    ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.setLineDash([h * 0.06, h * 0.05]);
    ctx.lineDashOffset = -((state.distance * 3) % (h * 0.11));
    for (let lane = 1; lane < LANES; lane++) {
      const x = (w / LANES) * lane;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const laneCentre = (lane: number) => (w / LANES) * (lane + 0.5);
    const carW = (w / LANES) * 0.56;
    const carH = h * 0.13;

    for (const o of state.obstacles) {
      const x = laneCentre(o.lane);
      const y = o.y * h;
      if (o.kind === "pothole") {
        ctx.fillStyle = "#11141a";
        ctx.beginPath();
        ctx.ellipse(x, y, carW * 0.42, carH * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = o.kind === "keke" ? "#e8c85a" : "#d0553f";
        roundRect(ctx, x - carW / 2, y - carH / 2, carW, carH, carH * 0.22);
        ctx.fill();
        ctx.fillStyle = "#00000055";
        roundRect(ctx, x - carW / 2 + carW * 0.12, y - carH * 0.2, carW * 0.76, carH * 0.28, 3);
        ctx.fill();
      }
    }

    // The danfo: a yellow bus, which is the only thing it could be.
    const px = laneCentre(state.lane);
    const py = PLAYER_Y * h;
    ctx.fillStyle = state.crashed ? "#8a8a8a" : "#f2c230";
    roundRect(ctx, px - carW / 2, py - carH / 2, carW, carH, carH * 0.2);
    ctx.fill();
    ctx.fillStyle = "#2a2f38";
    roundRect(ctx, px - carW / 2 + carW * 0.14, py - carH * 0.34, carW * 0.72, carH * 0.26, 3);
    ctx.fill();
    ctx.fillStyle = "#1a1d23";
    roundRect(ctx, px - carW / 2 + carW * 0.14, py + carH * 0.06, carW * 0.72, carH * 0.16, 3);
    ctx.fill();
  }, []);

  const loop = useCallback(
    (time: number) => {
      const dt = lastRef.current ? (time - lastRef.current) / 1000 : 0;
      lastRef.current = time;

      const next = step(stateRef.current, dt);
      stateRef.current = next;
      setScore(Math.floor(next.distance));
      draw();

      if (next.crashed) {
        setRunning(false);
        setCrashed(true);
        setBest((current) => {
          const record = Math.max(current, Math.floor(next.distance));
          try {
            window.localStorage.setItem(BEST_KEY, String(record));
          } catch {
            /* not remembered */
          }
          return record;
        });
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    },
    [draw]
  );

  const start = useCallback(() => {
    stateRef.current = createDash();
    lastRef.current = 0;
    setScore(0);
    setCrashed(false);
    setRunning(true);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const steer = useCallback((direction: -1 | 1) => {
    stateRef.current = moveLane(stateRef.current, direction);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a") steer(-1);
      if (e.key === "ArrowRight" || e.key === "d") steer(1);
      if ((e.key === " " || e.key === "Enter") && !running) start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, start, steer]);

  // Size the backing store to the element so nothing is blurry.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      draw();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draw]);

  return (
    <div className="dash">
      <div className="dash-hud card-panel">
        <span className="dash-score">{score} m</span>
        <span className="dash-best">best {best} m</span>
      </div>

      <div className="dash-stage">
        <canvas ref={canvasRef} className="dash-canvas" />
        {!running && (
          <div className="dash-overlay">
            <h2>{crashed ? `${score} m` : "Danfo Dash"}</h2>
            <p>{crashed ? "Wahala. Try again." : "Weave through the traffic. Arrow keys, or tap."}</p>
            <button type="button" onClick={start}>
              {crashed ? "Go again" : "Start"}
            </button>
          </div>
        )}
      </div>

      {/* Touch controls: half the audience is on a phone with no arrow keys. */}
      <div className="dash-controls">
        <button type="button" aria-label="Move left" onClick={() => steer(-1)}>
          ◀
        </button>
        <button type="button" aria-label="Move right" onClick={() => steer(1)}>
          ▶
        </button>
      </div>
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { DanfoDash };
