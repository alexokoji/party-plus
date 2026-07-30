import type { Face } from "../engine/types";

/**
 * One die on the table as the client is allowed to see it: `face` is null
 * for another player's unrevealed dice (the DO never sends those values —
 * see src/do/protocol.ts sanitizeState), and populated for the viewer's own
 * dice or any hand revealed in a challenge's RoundResult.
 */
export interface DieView {
  id: string;
  ownerId: string;
  face: Face | null;
}

export interface DiceRendererProps {
  /** All dice currently on the table, grouped implicitly by ownerId. */
  dice: DieView[];
  /** Bump this to trigger a settle animation toward each die's current `face`. */
  rollSeed: number;
  /** True once eliminated — spectators see everyone's dice face-up via RoundResult reveals. */
  isSpectator?: boolean;
}

/**
 * The dice animation layer is swappable behind this interface: the DO
 * decides the outcome (predetermined result), and any renderer's job is
 * only to *play* that outcome — never to decide it. Dice3D plays a settle
 * animation on a WebGL table; Dice2D is a plain DOM fallback for devices
 * that can't afford the 3D scene.
 */
export type DiceRenderer = React.ComponentType<DiceRendererProps>;
