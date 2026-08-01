import { describe, it, expect } from "vitest";
import { isPolite, loudness, MESH_LIMIT } from "./useVoiceChat";

describe("speaking detection", () => {
  /** A waveform centred on 128, which is what silence looks like from the analyser. */
  const silence = () => new Uint8Array(256).fill(128);
  const tone = (amplitude: number) =>
    Uint8Array.from({ length: 256 }, (_, i) => 128 + Math.round(Math.sin(i / 4) * amplitude));

  it("reads silence as silence", () => {
    expect(loudness(silence())).toBe(0);
  });

  it("rises with volume", () => {
    expect(loudness(tone(40))).toBeGreaterThan(loudness(tone(10)));
  });

  it("puts a normal voice above the speaking threshold, and room noise below", () => {
    // The UI treats 0.045 as speaking. Quiet background hiss must not light
    // everybody's indicator up permanently.
    expect(loudness(tone(3))).toBeLessThan(0.045);
    expect(loudness(tone(30))).toBeGreaterThan(0.045);
  });

  it("is bounded, whatever arrives", () => {
    expect(loudness(new Uint8Array(0))).toBe(0);
    expect(loudness(new Uint8Array(64).fill(255))).toBeLessThanOrEqual(1);
  });
});

describe("negotiation roles", () => {
  it("makes exactly one side of a pair polite", () => {
    // Both peers compute this independently and must disagree, or a collision
    // of simultaneous offers deadlocks the call.
    const pairs = [
      ["u_aaa", "u_bbb"],
      ["g_zzz", "u_aaa"],
      ["u_1", "u_2"],
    ];
    for (const [x, y] of pairs) {
      expect(isPolite(x!, y!)).not.toBe(isPolite(y!, x!));
    }
  });

  it("is stable across calls", () => {
    expect(isPolite("u_a", "u_b")).toBe(isPolite("u_a", "u_b"));
  });
});

describe("mesh sizing", () => {
  it("caps the call before a phone starts uploading a dozen streams", () => {
    // Everyone sends to everyone: at N people each uploads N-1 streams, so the
    // cost climbs with the square of the table.
    expect(MESH_LIMIT).toBeLessThanOrEqual(8);
    const uploadsAtLimit = MESH_LIMIT - 1;
    expect(uploadsAtLimit * 40).toBeLessThan(400); // kbps, Opus voice
  });
});
