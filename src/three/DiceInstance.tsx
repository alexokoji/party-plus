"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BoxGeometry,
  Euler,
  InstancedMesh,
  Material,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import type { Face } from "../engine/types";
import { BOX_GROUP_FACE_ORDER, quaternionForFace, uprightQuaternion } from "./faceOrientation";
import { getPipTexture } from "./pipTexture";
import { type DieAnim, ROLL_DURATION_S, settleQuaternion, settleState } from "./settle";

const DIE_SIZE = 0.9;

/** Mid-air tumble to animate *from*; never used as a resting orientation. */
function randomQuaternion(): Quaternion {
  return new Quaternion().setFromEuler(
    new Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2)
  );
}

/**
 * Where a die comes to rest. Always flat on the table: a known face up when
 * the client is allowed to see it, otherwise blank but still square. The
 * random yaw is purely cosmetic and cannot tip the die.
 */
function restingQuaternion(face: Face | null): Quaternion {
  const yaw = Math.random() * Math.PI * 2;
  if (face === null) return uprightQuaternion(yaw);
  // Spin about world Y *after* orienting the face upward, so the yaw varies
  // the look without disturbing which face points up.
  return uprightQuaternion(yaw).multiply(quaternionForFace(face));
}

export interface DiceFieldDie {
  id: string;
  position: [number, number, number];
  /** null = hidden die (opponent's unrevealed dice) — settles to a random spin, not a real face. */
  face: Face | null;
}

export interface DiceFieldProps {
  dice: DiceFieldDie[];
  rollSeed: number;
}

/**
 * Renders every die on the table as instanced meshes — one for revealed dice
 * (per-face pip materials) and one for hidden dice (a single blank material).
 * Draw calls stay at two regardless of dice count, which is the point of
 * instancing for the mobile frame budget.
 */
export function DiceField({ dice, rollSeed }: DiceFieldProps) {
  const revealed = useMemo(() => dice.filter((d) => d.face !== null), [dice]);
  const hidden = useMemo(() => dice.filter((d) => d.face === null), [dice]);

  const pipMaterials = useMemo(
    () => BOX_GROUP_FACE_ORDER.map((face) => new MeshStandardMaterial({ map: getPipTexture(face) })),
    []
  );
  const blankMaterial = useMemo(() => new MeshStandardMaterial({ map: getPipTexture(0) }), []);

  return (
    <>
      {revealed.length > 0 && (
        <InstancedDice dice={revealed} rollSeed={rollSeed} material={pipMaterials} />
      )}
      {hidden.length > 0 && <InstancedDice dice={hidden} rollSeed={rollSeed} material={blankMaterial} />}
    </>
  );
}

/**
 * Animates a set of dice by writing instance matrices directly in useFrame —
 * no React re-render per frame.
 *
 * The scene runs on frameloop="demand" (see Dice3D), so this must explicitly
 * request the next frame via invalidate() for as long as dice are still
 * settling, and stop once they are all at rest. Without that stop condition
 * the canvas would redraw at 60fps forever on a completely static table,
 * which is exactly the kind of idle GPU drain that kills battery and thermal
 * headroom on a mid-range Android.
 */
function InstancedDice({
  dice,
  rollSeed,
  material,
}: DiceFieldProps & { material: Material | Material[] }) {
  const meshRef = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(() => new BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE), []);
  const anims = useRef(new Map<string, DieAnim>());

  // Scratch objects reused every frame; allocating per-die per-frame would
  // churn the GC on mobile.
  const scratch = useMemo(
    () => ({ matrix: new Matrix4(), quat: new Quaternion(), pos: new Vector3(), scale: new Vector3(1, 1, 1) }),
    []
  );

  const diceKey = dice.map((d) => d.id).join("|");

  useLayoutEffect(() => {
    const now = performance.now() / 1000;
    const next = new Map<string, DieAnim>();
    for (const die of dice) {
      const prev = anims.current.get(die.id);
      // Start from wherever the die currently is, so a re-roll mid-settle
      // continues smoothly instead of snapping back.
      const startQuat = prev
        ? settleQuaternion(prev, now, new Quaternion())
        : randomQuaternion();
      next.set(die.id, {
        startQuat,
        targetQuat: restingQuaternion(die.face),
        startTime: now,
      });
    }
    anims.current = next;
    invalidate(); // kick off the settle animation under frameloop="demand"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollSeed, diceKey, invalidate]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const now = performance.now() / 1000;
    let stillSettling = false;

    dice.forEach((die, i) => {
      const anim = anims.current.get(die.id);
      if (!anim) return;
      if (settleState(anim, now).animating) stillSettling = true;
      settleQuaternion(anim, now, scratch.quat);
      scratch.pos.set(die.position[0], die.position[1], die.position[2]);
      scratch.matrix.compose(scratch.pos, scratch.quat, scratch.scale);
      mesh.setMatrixAt(i, scratch.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (stillSettling) invalidate();
  });

  // The material MUST be constructed with the mesh, not attached afterwards.
  // R3F rebuilds this mesh whenever `args` change — which includes every time
  // the dice count changes (a new match, or anyone losing a die) — and a mesh
  // built with no material silently falls back to three's default white one.
  return <instancedMesh ref={meshRef} args={[geometry, material, dice.length]} />;
}
