import { Euler, Quaternion } from "three";
import type { Face } from "../engine/types";

/**
 * Canonical face assignment for the die's BoxGeometry (opposite faces sum
 * to 7, matching a real die): +Y=1, -Y=6, +X=2, -X=5, +Z=3, -Z=4. The euler
 * below is the rotation that brings each face to point +Y ("up"), derived
 * by hand from the standard axis-rotation matrices — not guessable from the
 * geometry alone, so keep this comment if you touch it.
 */
const FACE_UP_EULER: Record<Face, Euler> = {
  1: new Euler(0, 0, 0),
  2: new Euler(0, 0, Math.PI / 2),
  3: new Euler(-Math.PI / 2, 0, 0),
  4: new Euler(Math.PI / 2, 0, 0),
  5: new Euler(0, 0, -Math.PI / 2),
  6: new Euler(Math.PI, 0, 0),
};

export function quaternionForFace(face: Face): Quaternion {
  return new Quaternion().setFromEuler(FACE_UP_EULER[face]);
}

/** BoxGeometry face-group order is [+X, -X, +Y, -Y, +Z, -Z]; map to our pip counts. */
export const BOX_GROUP_FACE_ORDER: Face[] = [2, 5, 1, 6, 3, 4];

/**
 * A die resting flat on the table, rotated only about the vertical axis.
 *
 * Hidden dice (opponents' hands) have no face to show, but they are still
 * physical dice sitting on a table — they must come to rest square and
 * upright like everyone else's, just blank. Settling them to a fully random
 * orientation instead leaves them visibly tumbled and half-sunk through the
 * felt. `yaw` only spins them in place, which keeps the arrangement from
 * looking mechanically identical without ever tipping a die over.
 */
export function uprightQuaternion(yaw: number): Quaternion {
  return new Quaternion().setFromEuler(new Euler(0, yaw, 0));
}
