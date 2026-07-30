import type { DieView } from "../animation/types";
import type { Face } from "../engine/types";

export const DICE_PER_ROW = 5;
export const DICE_SPACING = 1.15;
export const SEAT_RADIUS = 3.2;
export const TABLE_RADIUS = 6;
/** How far a die may drift from its slot, as a fraction of the spacing. */
export const SCATTER = 0.3;
/** Half the die height — dice rest ON the felt, not sunk into it. */
export const DIE_REST_Y = 0.45;

export interface PlacedDie {
  id: string;
  position: [number, number, number];
  face: Face | null;
}

/**
 * Stable pseudo-random in [-1, 1] from a die id and a salt.
 *
 * Deterministic per die so the scatter stays put between renders — using
 * Math.random() here would make dice jitter every time the layout recomputes.
 */
export function jitter(id: string, salt: number): number {
  let hash = salt * 2654435761;
  for (let i = 0; i < id.length; i++) hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 1274126177);
  hash ^= hash >>> 16;
  return ((hash >>> 0) / 4294967295) * 2 - 1;
}

/**
 * Lays each owner's dice on the table, seats arranged in a circle. Seat 0 sits
 * nearest the camera (+Z) and seats advance around the table.
 *
 * A hand spreads ALONG the table edge (the tangent), never down the radius:
 * a radial row points straight at or away from the camera and projects to a
 * vertical stack of dice rather than a readable row.
 */
export function layoutDice(dice: DieView[]): PlacedDie[] {
  const owners = [...new Set(dice.map((d) => d.ownerId))];
  const result: PlacedDie[] = [];

  owners.forEach((ownerId, seatIndex) => {
    const angle = Math.PI / 2 + (seatIndex / owners.length) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const seatX = cos * SEAT_RADIUS;
    const seatZ = sin * SEAT_RADIUS;
    const ownerDice = dice.filter((d) => d.ownerId === ownerId);

    const tangentX = -sin;
    const tangentZ = cos;
    const inwardX = -cos;
    const inwardZ = -sin;

    ownerDice.forEach((die, i) => {
      const row = Math.floor(i / DICE_PER_ROW);
      const col = i % DICE_PER_ROW;
      // Dice were thrown, not placed: nudge each one off its slot so a hand
      // reads as a scattered throw rather than a filing cabinet.
      const acrossRow =
        (col - (Math.min(ownerDice.length, DICE_PER_ROW) - 1) / 2) * DICE_SPACING +
        jitter(die.id, 1) * DICE_SPACING * SCATTER;
      const towardCenter = row * DICE_SPACING + jitter(die.id, 2) * DICE_SPACING * SCATTER;
      result.push({
        id: die.id,
        face: die.face,
        position: [
          seatX + acrossRow * tangentX + towardCenter * inwardX,
          DIE_REST_Y,
          seatZ + acrossRow * tangentZ + towardCenter * inwardZ,
        ],
      });
    });
  });

  return result;
}
