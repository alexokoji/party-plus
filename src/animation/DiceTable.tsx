"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Dice2D } from "./Dice2D";
import { chooseRenderer, detectEnvironment, type RendererMode } from "./rendererChoice";
import type { DiceRendererProps } from "./types";

// three.js is ~167KB gzip on its own; only fetch it for clients that will
// actually render the 3D table, and never during SSR (Canvas needs window).
const Dice3D = dynamic(() => import("../three/Dice3D").then((m) => m.Dice3D), { ssr: false });

export interface DiceTableProps extends DiceRendererProps {
  /** Force a renderer; defaults to auto-detecting capability, motion and data preferences. */
  mode?: "3d" | "2d" | "auto";
}

/**
 * Picks the dice animation layer at runtime. Both Dice3D and Dice2D
 * implement the same DiceRendererProps contract, so this is the only place
 * that needs to know the fallback exists. The policy itself lives in
 * chooseRenderer() so it can be tested without a browser.
 */
export function DiceTable({ mode = "auto", ...rendererProps }: DiceTableProps) {
  const [resolvedMode, setResolvedMode] = useState<RendererMode | null>(
    mode === "auto" ? null : mode
  );

  useEffect(() => {
    if (mode !== "auto") {
      setResolvedMode(mode);
      return;
    }
    setResolvedMode(chooseRenderer(detectEnvironment()));
  }, [mode]);

  if (resolvedMode === null) return null; // avoid a flash of the wrong renderer during detection
  if (resolvedMode === "2d") {
    return (
      <div style={{ padding: "1.5rem" }}>
        <Dice2D {...rendererProps} />
      </div>
    );
  }
  return (
    <div style={{ width: "100%", height: "30rem" }}>
      <Dice3D {...rendererProps} />
    </div>
  );
}
