import { describe, it, expect } from "vitest";
import { chooseRenderer, type RendererEnvironment } from "./rendererChoice";

const capable: RendererEnvironment = {
  webgl: true,
  prefersReducedMotion: false,
  connection: { saveData: false, effectiveType: "4g" },
  deviceMemoryGB: 8,
};

describe("chooseRenderer", () => {
  it("uses 3D on a capable device with a fast, unmetered connection", () => {
    expect(chooseRenderer(capable)).toBe("3d");
  });

  it("falls back to 2D without WebGL", () => {
    expect(chooseRenderer({ ...capable, webgl: false })).toBe("2d");
  });

  it("falls back to 2D when the user prefers reduced motion", () => {
    expect(chooseRenderer({ ...capable, prefersReducedMotion: true })).toBe("2d");
  });

  it("honours Data Saver even on a fast connection", () => {
    expect(
      chooseRenderer({ ...capable, connection: { saveData: true, effectiveType: "4g" } })
    ).toBe("2d");
  });

  it.each(["slow-2g", "2g"])("falls back to 2D on %s", (effectiveType) => {
    expect(chooseRenderer({ ...capable, connection: { effectiveType } })).toBe("2d");
  });

  it("stays on 3D for 4g", () => {
    expect(chooseRenderer({ ...capable, connection: { effectiveType: "4g" } })).toBe("3d");
  });

  // Browsers report "3g" across a very wide range of real-world speeds — a
  // capable desktop was observed reporting it — so it must not force 2D.
  it("stays on 3D for 3g", () => {
    expect(chooseRenderer({ ...capable, connection: { effectiveType: "3g" } })).toBe("3d");
  });

  it("still honours Data Saver on a 3g connection", () => {
    expect(
      chooseRenderer({ ...capable, connection: { effectiveType: "3g", saveData: true } })
    ).toBe("2d");
  });

  it("falls back to 2D on very low-memory devices", () => {
    expect(chooseRenderer({ ...capable, deviceMemoryGB: 0.5 })).toBe("2d");
    expect(chooseRenderer({ ...capable, deviceMemoryGB: 1 })).toBe("2d");
  });

  it("stays on 3D when memory is adequate", () => {
    expect(chooseRenderer({ ...capable, deviceMemoryGB: 2 })).toBe("3d");
  });

  it("defaults to 3D when the Network Information API is unavailable", () => {
    expect(
      chooseRenderer({ webgl: true, prefersReducedMotion: false, connection: undefined, deviceMemoryGB: undefined })
    ).toBe("3d");
  });
});
