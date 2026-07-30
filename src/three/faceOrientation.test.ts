import { describe, it, expect } from "vitest";
import { Vector3 } from "three";
import { BOX_GROUP_FACE_ORDER, quaternionForFace, uprightQuaternion } from "./faceOrientation";
import type { Face } from "../engine/types";

/**
 * Outward normal of each pip face in the die's own local space, per the
 * canonical assignment documented in faceOrientation.ts
 * (+Y=1, -Y=6, +X=2, -X=5, +Z=3, -Z=4).
 */
const FACE_NORMAL: Record<Face, Vector3> = {
  1: new Vector3(0, 1, 0),
  6: new Vector3(0, -1, 0),
  2: new Vector3(1, 0, 0),
  5: new Vector3(-1, 0, 0),
  3: new Vector3(0, 0, 1),
  4: new Vector3(0, 0, -1),
};

const ALL_FACES: Face[] = [1, 2, 3, 4, 5, 6];
const UP = new Vector3(0, 1, 0);

describe("quaternionForFace", () => {
  it.each(ALL_FACES)("puts face %i pointing up", (face) => {
    const rotated = FACE_NORMAL[face].clone().applyQuaternion(quaternionForFace(face));
    // The rotated face normal should align with world up.
    expect(rotated.dot(UP)).toBeCloseTo(1, 6);
  });

  it("never lands a different face up than the one requested", () => {
    for (const face of ALL_FACES) {
      const quat = quaternionForFace(face);
      const upFaces = ALL_FACES.filter(
        (candidate) => FACE_NORMAL[candidate].clone().applyQuaternion(quat).dot(UP) > 0.999
      );
      expect(upFaces).toEqual([face]);
    }
  });
});

describe("uprightQuaternion", () => {
  const yaws = [0, 0.3, Math.PI / 2, Math.PI, 4.1, Math.PI * 2];

  it.each(yaws)("keeps the die flat on the table at yaw %f", (yaw) => {
    // Whatever the yaw, the die's local up axis must still point at world up:
    // a hidden die is still a die resting on a table, never a tumbled one.
    const up = new Vector3(0, 1, 0).applyQuaternion(uprightQuaternion(yaw));
    expect(up.dot(UP)).toBeCloseTo(1, 6);
  });

  it("only spins about the vertical axis, so some face is always exactly up", () => {
    for (const yaw of yaws) {
      const quat = uprightQuaternion(yaw);
      const upFaces = ALL_FACES.filter(
        (face) => FACE_NORMAL[face].clone().applyQuaternion(quat).dot(UP) > 0.999
      );
      expect(upFaces).toHaveLength(1);
    }
  });

  it("keeps the requested face up when combined with a face orientation", () => {
    for (const face of ALL_FACES) {
      const resting = uprightQuaternion(1.234).multiply(quaternionForFace(face));
      const up = FACE_NORMAL[face].clone().applyQuaternion(resting);
      expect(up.dot(UP)).toBeCloseTo(1, 6);
    }
  });
});

describe("BOX_GROUP_FACE_ORDER", () => {
  it("matches BoxGeometry's material-group order [+X,-X,+Y,-Y,+Z,-Z]", () => {
    expect(BOX_GROUP_FACE_ORDER).toEqual([2, 5, 1, 6, 3, 4]);
  });

  it("puts opposite faces on opposite sides, summing to 7 like a real die", () => {
    const [posX, negX, posY, negY, posZ, negZ] = BOX_GROUP_FACE_ORDER;
    expect(posX! + negX!).toBe(7);
    expect(posY! + negY!).toBe(7);
    expect(posZ! + negZ!).toBe(7);
  });

  it("uses each face exactly once", () => {
    expect([...BOX_GROUP_FACE_ORDER].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
