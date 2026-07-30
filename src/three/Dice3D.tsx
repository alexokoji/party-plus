"use client";

import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import type { DiceRendererProps } from "../animation/types";
import { DiceField } from "./DiceInstance";
import { layoutDice, TABLE_RADIUS } from "./layout";

/** Neon party lights orbiting the table — cheap colored point lights, no assets. */
function PartyLights() {
  const colors = ["#ff2ea8", "#21e8ff", "#9d4dff", "#ffd166"];
  return (
    <>
      {colors.map((color, i) => {
        const angle = (i / colors.length) * Math.PI * 2;
        return (
          <pointLight
            key={color}
            color={color}
            position={[Math.cos(angle) * 5, 2.5, Math.sin(angle) * 5]}
            intensity={6}
            distance={9}
            decay={2}
          />
        );
      })}
    </>
  );
}

/** Casino felt table: deep emerald center, a gold trim ring, and a glowing rim light. */
function TableSurface() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[TABLE_RADIUS, 48]} />
        <meshStandardMaterial color="#0c3d2e" roughness={0.75} metalness={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <ringGeometry args={[TABLE_RADIUS - 0.12, TABLE_RADIUS, 64]} />
        <meshStandardMaterial color="#ffd166" emissive="#ffb347" emissiveIntensity={0.6} metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

/**
 * WebGL table: instanced low-poly dice, no external HDRI/image assets (pips
 * are drawn to canvas at runtime — see pipTexture.ts), DPR capped at 2 so a
 * high-DPI phone doesn't force 3x+ supersampled rendering. Party-casino
 * lighting rig (colored point lights + gold rim) stays cheap: a handful of
 * point lights and one emissive ring, no post-processing passes.
 *
 * frameloop="demand" means the canvas only renders when something asks it to
 * (see InstancedDice, which requests frames while dice settle and stops when
 * they are at rest). A Liar's Dice table is static most of the time — players
 * are thinking, not moving — so a continuous 60fps loop would burn battery to
 * redraw an identical image. Shadow maps are deliberately off: they are one
 * of the most expensive things to enable on a mid-range Android GPU, and at
 * this camera angle they buy very little.
 */
export function Dice3D({ dice, rollSeed }: DiceRendererProps) {
  const layout = useMemo(() => layoutDice(dice), [dice]);

  return (
    <Canvas
      dpr={[1, 2]}
      frameloop="demand"
      // Pulled back and raised so the full seat ring fits in frame — at a
      // closer/lower camera the near player's row falls off the bottom edge.
      camera={{ position: [0, 10.5, 10.5], fov: 42 }}
      gl={{ antialias: true, powerPreference: "low-power" }}
      style={{ width: "100%", height: "100%", touchAction: "none" }}
    >
      <color attach="background" args={["#0a0710"]} />
      <fog attach="fog" args={["#0a0710", 16, 30]} />
      {/* Ambient carries the far side of the table: the key light alone leaves
          opponents' dice almost black, which hides how many dice they hold. */}
      <ambientLight intensity={0.85} color="#6b5a8a" />
      <directionalLight position={[4, 8, 3]} intensity={1.2} color="#fff4e0" />
      <directionalLight position={[-3, 6, -5]} intensity={0.5} color="#9fd8ff" />
      <PartyLights />
      <TableSurface />
      <DiceField dice={layout} rollSeed={rollSeed} />
    </Canvas>
  );
}
