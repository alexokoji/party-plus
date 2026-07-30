"use client";

import { useEffect, useState } from "react";
import type { DiceRendererProps } from "./types";

const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [25, 25],
    [75, 75],
  ],
  3: [
    [25, 25],
    [50, 50],
    [75, 75],
  ],
  4: [
    [25, 25],
    [75, 25],
    [25, 75],
    [75, 75],
  ],
  5: [
    [25, 25],
    [75, 25],
    [50, 50],
    [25, 75],
    [75, 75],
  ],
  6: [
    [25, 25],
    [75, 25],
    [25, 50],
    [75, 50],
    [25, 75],
    [75, 75],
  ],
};

function Pips({ face }: { face: number }) {
  return (
    <>
      {PIP_LAYOUTS[face]!.map(([x, y], i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${x}%`,
            top: `${y}%`,
            width: "16%",
            aspectRatio: "1",
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            background: "#1a1a1a",
          }}
        />
      ))}
    </>
  );
}

/**
 * Plain-DOM fallback for the dice animation layer — no WebGL, no three.js.
 * Fulfils the same DiceRendererProps contract as Dice3D so callers can swap
 * renderers without touching game logic. "Rolling" plays as a brief spin/
 * flicker through random faces before settling on the real result, so a
 * predetermined outcome still reads as a roll rather than an instant swap.
 */
export function Dice2D({ dice, rollSeed }: DiceRendererProps) {
  const [displayFaces, setDisplayFaces] = useState<Record<string, number>>({});

  useEffect(() => {
    let frame = 0;
    const totalFrames = 8;
    const interval = setInterval(() => {
      frame++;
      setDisplayFaces((prev) => {
        const next = { ...prev };
        for (const die of dice) {
          if (die.face === null) continue;
          next[die.id] = frame >= totalFrames ? die.face : 1 + Math.floor(Math.random() * 6);
        }
        return next;
      });
      if (frame >= totalFrames) clearInterval(interval);
    }, 60);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollSeed]);

  const byOwner = new Map<string, typeof dice>();
  for (const die of dice) {
    const list = byOwner.get(die.ownerId) ?? [];
    list.push(die);
    byOwner.set(die.ownerId, list);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {[...byOwner.entries()].map(([ownerId, ownerDice]) => (
        <div key={ownerId} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ minWidth: "6rem", color: "#9aa1ad", fontSize: "0.85rem" }}>{ownerId}</span>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {ownerDice.map((die) => {
              const shownFace = displayFaces[die.id] ?? die.face;
              return (
                <div
                  key={die.id}
                  style={{
                    position: "relative",
                    width: "2.25rem",
                    height: "2.25rem",
                    background: shownFace === null ? "#33384a" : "#f4f4f4",
                    borderRadius: "0.35rem",
                    boxShadow: "inset 0 0 0 1px #00000022",
                  }}
                >
                  {shownFace !== null && shownFace !== undefined && <Pips face={shownFace} />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
