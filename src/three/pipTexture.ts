import { CanvasTexture, SRGBColorSpace } from "three";

const PIP_LAYOUTS: Record<number, [number, number][]> = {
  0: [], // blank/face-down die (opponent's unrevealed dice)
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.28, 0.28],
    [0.5, 0.5],
    [0.72, 0.72],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.5, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  6: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
};

const SIZE = 128;
const textureCache = new Map<number, CanvasTexture>();

/**
 * Draws a die face as a canvas texture at runtime — no image assets to ship,
 * which keeps the whole table well under the <200KB budget (the entire
 * scene is procedural geometry + these tiny canvases). Cached per pip count
 * since every die shares the same six textures.
 */
export function getPipTexture(pipCount: number): CanvasTexture {
  const cached = textureCache.get(pipCount);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  // Blank (opponent) dice stay clearly darker than revealed ones, but light
  // enough to still read as dice on the far side of the table.
  ctx.fillStyle = pipCount === 0 ? "#6d6a92" : "#f4f4f4";
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = "#1a1a1a";
  const radius = SIZE * 0.09;
  for (const [x, y] of PIP_LAYOUTS[pipCount] ?? []) {
    ctx.beginPath();
    ctx.arc(x * SIZE, y * SIZE, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  textureCache.set(pipCount, texture);
  return texture;
}
