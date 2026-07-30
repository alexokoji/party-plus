export type RendererMode = "3d" | "2d";

/** The subset of navigator.connection (Network Information API) we care about. */
export interface ConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

export interface RendererEnvironment {
  webgl: boolean;
  prefersReducedMotion: boolean;
  connection?: ConnectionLike | undefined;
  deviceMemoryGB?: number | undefined;
}

/**
 * Connection classes where downloading ~167KB gzip of three.js is a bad trade.
 *
 * Deliberately excludes "3g": browsers report 3g for a very wide range of
 * real speeds (including desktops on a merely mediocre link — observed on a
 * capable dev machine), so gating on it downgrades players who can comfortably
 * afford the 3D table. Data *cost*, as opposed to speed, is what saveData
 * signals, and that is honoured separately below.
 */
const SLOW_EFFECTIVE_TYPES = new Set(["slow-2g", "2g"]);

/**
 * Decides between the 3D table and the 2D fallback.
 *
 * The 3D path costs ~167KB gzip of three.js on top of the app bundle, fetched
 * lazily the first time a table renders. On a metered or slow connection that
 * is a real cost to the player, so anything signalling "data is expensive or
 * scarce" falls back to the DOM renderer, which ships no extra JS at all.
 *
 * Pure and dependency-free so the policy is unit-testable without a browser.
 */
export function chooseRenderer(env: RendererEnvironment): RendererMode {
  if (!env.webgl) return "2d";
  if (env.prefersReducedMotion) return "2d";

  // Explicit user signal ("Data Saver" / Low Data Mode) — always honour it.
  if (env.connection?.saveData === true) return "2d";

  const effectiveType = env.connection?.effectiveType;
  if (effectiveType && SLOW_EFFECTIVE_TYPES.has(effectiveType)) return "2d";

  // Very low-memory devices tend to be exactly the phones that cannot hold a
  // 60fps WebGL frame budget anyway.
  if (typeof env.deviceMemoryGB === "number" && env.deviceMemoryGB > 0 && env.deviceMemoryGB <= 1) {
    return "2d";
  }

  return "3d";
}

/** Reads the current browser environment. Returns a conservative result during SSR. */
export function detectEnvironment(): RendererEnvironment {
  if (typeof window === "undefined") {
    return { webgl: false, prefersReducedMotion: false };
  }
  const nav = navigator as Navigator & { connection?: ConnectionLike; deviceMemory?: number };
  return {
    webgl: supportsWebGL(),
    prefersReducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    connection: nav.connection,
    deviceMemoryGB: nav.deviceMemory,
  };
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
