import { describe, it, expect } from "vitest";
import { Quaternion, Vector3 } from "three";
import { easeOutCubic, ROLL_DURATION_S, settleQuaternion, settleState, type DieAnim } from "./settle";
import { quaternionForFace } from "./faceOrientation";

function anim(start: Quaternion, target: Quaternion, startTime = 0): DieAnim {
  return { startQuat: start, targetQuat: target, startTime };
}

describe("easeOutCubic", () => {
  it("is pinned at both ends", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("decelerates — covers more than half the distance by the halfway point", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it("is monotonically increasing", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = easeOutCubic(i / 20);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe("settleState", () => {
  const a = anim(quaternionForFace(1), quaternionForFace(4));

  it("reports animating at the start and for the whole roll duration", () => {
    expect(settleState(a, 0).animating).toBe(true);
    expect(settleState(a, ROLL_DURATION_S * 0.99).animating).toBe(true);
  });

  it("stops animating exactly at the end — this is what lets the frameloop idle", () => {
    expect(settleState(a, ROLL_DURATION_S).animating).toBe(false);
    expect(settleState(a, ROLL_DURATION_S + 5).animating).toBe(false);
  });

  it("clamps progress into 0..1 for times before the start or long after", () => {
    expect(settleState(a, -10).t).toBe(0);
    expect(settleState(a, 999).t).toBe(1);
  });

  it("advances monotonically over the roll", () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const s = settleState(a, (ROLL_DURATION_S * i) / 20);
      expect(s.t).toBeGreaterThanOrEqual(prev);
      prev = s.t;
    }
  });
});

describe("settleQuaternion", () => {
  const UP = new Vector3(0, 1, 0);

  it("actually rotates the die over time rather than snapping (dice must visibly tumble)", () => {
    const a = anim(quaternionForFace(1), quaternionForFace(4));
    const out = new Quaternion();
    const samples = [0, 0.15, 0.3, 0.45, 0.6, ROLL_DURATION_S].map((t) =>
      settleQuaternion(a, t, out).clone()
    );
    // Every consecutive pair should differ — a die that snapped would show
    // identical orientations until the final frame.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.angleTo(samples[i - 1]!)).toBeGreaterThan(1e-4);
    }
  });

  it("ends exactly on the target orientation for every face", () => {
    for (const face of [1, 2, 3, 4, 5, 6] as const) {
      const target = quaternionForFace(face);
      const a = anim(quaternionForFace(1), target);
      const final = settleQuaternion(a, ROLL_DURATION_S, new Quaternion());
      expect(final.angleTo(target)).toBeCloseTo(0, 6);
    }
  });

  it("lands the predetermined face up — the server's result is what shows", () => {
    const FACE_NORMAL = {
      1: new Vector3(0, 1, 0),
      2: new Vector3(1, 0, 0),
      3: new Vector3(0, 0, 1),
      4: new Vector3(0, 0, -1),
      5: new Vector3(-1, 0, 0),
      6: new Vector3(0, -1, 0),
    } as const;

    for (const face of [1, 2, 3, 4, 5, 6] as const) {
      const a = anim(quaternionForFace(2), quaternionForFace(face));
      const final = settleQuaternion(a, ROLL_DURATION_S, new Quaternion());
      const up = FACE_NORMAL[face].clone().applyQuaternion(final);
      expect(up.dot(UP)).toBeCloseTo(1, 6);
    }
  });

  it("writes into the provided quaternion instead of allocating", () => {
    const a = anim(quaternionForFace(1), quaternionForFace(6));
    const out = new Quaternion();
    const returned = settleQuaternion(a, 0.3, out);
    expect(returned).toBe(out);
  });
});
