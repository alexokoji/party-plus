// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The audio context going to sleep is the whole story here.
 *
 * "Sound plays sometimes" turned out to be two versions of the same bug: the
 * app asked the browser to start audio exactly once and gave up if that failed,
 * and nothing ever noticed a context that had been suspended again later — by
 * backgrounding the tab, a phone call, or an OS interruption. Both left a
 * session permanently silent with no way back.
 *
 * These tests pin the recovery: a suspended context is asked to resume when
 * somebody tries to make a sound, and asking again is always allowed.
 */

class FakeParam {
  value = 1;
  cancelScheduledValues() {}
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  setTargetAtTime() {}
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  detune = new FakeParam();
  type = "sine";
  buffer: unknown = null;
  connect() {
    return this;
  }
  disconnect() {}
  start() {}
  stop() {}
}

class FakeAudioContext {
  state: "suspended" | "running" = "suspended";
  currentTime = 0;
  destination = new FakeNode();
  sampleRate = 48000;
  resume = vi.fn(async () => {
    this.state = "running";
  });
  createGain() {
    return new FakeNode();
  }
  createOscillator() {
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeNode();
  }
  createWaveShaper() {
    return new FakeNode();
  }
  createBufferSource() {
    return new FakeNode();
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(128) };
  }
  createDynamicsCompressor() {
    return new FakeNode();
  }
}

let context: FakeAudioContext;

beforeEach(async () => {
  vi.resetModules();
  context = new FakeAudioContext();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = function () {
    return context;
  };
});

describe("waking the audio context", () => {
  it("asks a suspended context to resume when a sound is attempted", async () => {
    const { getEngine, playVoice } = await import("./engine");
    getEngine();
    expect(context.state).toBe("suspended");

    // This sound is lost — the context is asleep — but it must ask to wake up
    // rather than silently doing nothing forever.
    playVoice({ freq: 440, hold: 0.1 });
    expect(context.resume).toHaveBeenCalled();
  });

  it("plays once the context is running", async () => {
    const { getEngine, playVoice, unlock } = await import("./engine");
    getEngine();
    await unlock();
    expect(context.state).toBe("running");

    context.resume.mockClear();
    playVoice({ freq: 440, hold: 0.1 });
    // Already awake: no need to ask again.
    expect(context.resume).not.toHaveBeenCalled();
  });

  it("can be unlocked again after being suspended a second time", async () => {
    const { getEngine, unlock, isUnlocked } = await import("./engine");
    getEngine();
    expect(await unlock()).toBe(true);
    expect(isUnlocked()).toBe(true);

    // What happens when a tab is backgrounded, or a call comes in.
    context.state = "suspended";
    expect(await unlock()).toBe(true);
    expect(context.state).toBe("running");
  });

  it("reports failure rather than throwing when the browser refuses", async () => {
    const { getEngine, unlock } = await import("./engine");
    getEngine();
    context.resume = vi.fn(async () => {
      throw new Error("not allowed");
    });
    await expect(unlock()).resolves.toBe(false);
  });

  it("never throws out of a sound call, whatever the context is doing", async () => {
    const { getEngine, playVoice, playNoise } = await import("./engine");
    getEngine();
    context.resume = vi.fn(async () => {
      throw new Error("still refused");
    });
    expect(() => playVoice({ freq: 440, hold: 0.1 })).not.toThrow();
    expect(() => playNoise({ duration: 0.1 })).not.toThrow();
  });
});
