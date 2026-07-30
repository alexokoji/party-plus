import { Quaternion } from "three";

export const ROLL_DURATION_S = 0.7;

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export interface DieAnim {
  startQuat: Quaternion;
  targetQuat: Quaternion;
  startTime: number;
}

export interface SettleState {
  /** Raw progress 0..1. */
  t: number;
  /** Eased progress 0..1. */
  eased: number;
  /** False once the die has reached its final orientation. */
  animating: boolean;
}

/**
 * Progress of a single die's settle at time `now` (seconds).
 *
 * Pure so the roll animation can be verified without a WebGL context or an
 * animation frame loop — the renderer only applies what this returns.
 */
export function settleState(anim: DieAnim, now: number, duration = ROLL_DURATION_S): SettleState {
  const elapsed = now - anim.startTime;
  const t = duration <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / duration));
  return { t, eased: easeOutCubic(t), animating: t < 1 };
}

/** Orientation of a die mid-settle. Writes into `out` to avoid per-frame allocation. */
export function settleQuaternion(anim: DieAnim, now: number, out: Quaternion, duration = ROLL_DURATION_S): Quaternion {
  const { eased } = settleState(anim, now, duration);
  return out.slerpQuaternions(anim.startQuat, anim.targetQuat, eased);
}
