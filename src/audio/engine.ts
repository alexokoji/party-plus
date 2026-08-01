"use client";

/**
 * The audio engine.
 *
 * Everything here is SYNTHESISED rather than played from files. Three reasons,
 * in order of importance:
 *
 * 1. A pack of music and effects is megabytes. This project has cared about a
 *    phone data plan since the first commit, and audio would dwarf everything
 *    else on the page.
 * 2. Nothing can be "cut off". A clipped sound is what you get when a sample
 *    is truncated or a gain is snapped to zero — so every voice here ends on a
 *    smooth release ramp and its oscillator is stopped only after that ramp
 *    has finished. There is no sample to truncate.
 * 3. Looping music from a file has a seam at the loop point. Generated music
 *    has no loop, so there is nothing to hear.
 */

export type Bus = "music" | "sfx";

interface Engine {
  ctx: AudioContext;
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  /** Softens the hard edges of raw oscillators. */
  warmth: BiquadFilterNode;
}

let engine: Engine | null = null;
let unlocked = false;

const STORE_KEY = "games-dome.audio";

export interface AudioSettings {
  musicVolume: number;
  sfxVolume: number;
  musicOn: boolean;
  sfxOn: boolean;
}

export const DEFAULT_SETTINGS: AudioSettings = {
  // Music sits well under the effects: it is background, and a party game is
  // played while people talk over it.
  musicVolume: 0.22,
  sfxVolume: 0.55,
  musicOn: true,
  sfxOn: true,
};

export function loadSettings(): AudioSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AudioSettings): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    /* not remembered; still applies this session */
  }
}

/**
 * Builds the graph on first use.
 *
 * Deliberately not created at import time: constructing an AudioContext before
 * any user gesture leaves it suspended and, in some browsers, logs a warning
 * on every page load.
 */
export function getEngine(): Engine | null {
  if (typeof window === "undefined") return null;
  if (engine) return engine;

  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  const ctx = new Ctor();
  const master = ctx.createGain();
  const warmth = ctx.createBiquadFilter();
  const music = ctx.createGain();
  const sfx = ctx.createGain();

  // A gentle low-pass keeps synthesised tones from sounding thin and buzzy,
  // which is most of the difference between "instrument" and "beep".
  warmth.type = "lowpass";
  warmth.frequency.value = 5200;
  warmth.Q.value = 0.4;

  const settings = loadSettings();
  master.gain.value = 1;
  music.gain.value = settings.musicOn ? settings.musicVolume : 0;
  sfx.gain.value = settings.sfxOn ? settings.sfxVolume : 0;

  music.connect(warmth);
  sfx.connect(warmth);
  warmth.connect(master);
  master.connect(ctx.destination);

  engine = { ctx, master, music, sfx, warmth };
  return engine;
}

/**
 * Resumes audio after a user gesture.
 *
 * Browsers refuse to start audio without one, which is the right policy — a
 * site that makes noise before you touch it is a bad site. Called from the
 * first click, key press or touch anywhere in the app.
 */
export async function unlock(): Promise<boolean> {
  const e = getEngine();
  if (!e) return false;
  if (e.ctx.state === "suspended") {
    try {
      await e.ctx.resume();
    } catch {
      return false;
    }
  }
  unlocked = e.ctx.state === "running";
  return unlocked;
}

export const isUnlocked = () => unlocked;

/** Smoothly rides a bus to a new level. Never a step, which would click. */
export function setBusVolume(bus: Bus, value: number, rampMs = 120): void {
  const e = getEngine();
  if (!e) return;
  const node = bus === "music" ? e.music : e.sfx;
  const now = e.ctx.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(Math.max(0.0001, node.gain.value), now);
  node.gain.linearRampToValueAtTime(Math.max(0.0001, value), now + rampMs / 1000);
}

export interface VoiceOptions {
  bus?: Bus;
  type?: OscillatorType;
  /** Start frequency in Hz. */
  freq: number;
  /** Optional glide target, for slides and falls. */
  toFreq?: number;
  /** Peak level for this voice, before the bus gain. */
  gain?: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  /** Seconds to wait before starting. */
  delay?: number;
  /** Length of the held portion, between decay and release. */
  hold?: number;
  /** Detune in cents, for thickening a note with a second voice. */
  detune?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number };
}

/**
 * One synthesised note, with a real envelope.
 *
 * This function is why nothing here sounds truncated: the gain rises over the
 * attack, falls to the sustain level, holds, then releases along an
 * exponential curve — and `stop()` is scheduled AFTER the release completes,
 * with a little margin. Stopping an oscillator while it is still audible is
 * exactly the click the ear reads as a cut-off sound.
 */

/**
 * True when sound can be made right now, and a nudge back towards it when not.
 *
 * A suspended context silently swallows every sound. Simply returning made the
 * whole system feel unreliable — audio would work, then stop after the tab had
 * been in the background, and never come back on its own. Asking it to resume
 * here means the sound after this one has a chance, without ever blocking the
 * caller or throwing on a browser that refuses.
 */
function audible(e: Engine | null): e is Engine {
  if (!e) return false;
  if (e.ctx.state === "running") return true;
  void e.ctx.resume().catch(() => {});
  return false;
}

export function playVoice(options: VoiceOptions): void {
  const e = getEngine();
  if (!audible(e)) return;

  const {
    bus = "sfx",
    type = "sine",
    freq,
    toFreq,
    gain = 0.3,
    attack = 0.01,
    decay = 0.08,
    sustain = 0.55,
    release = 0.18,
    delay = 0,
    hold = 0.05,
    detune = 0,
    filter,
  } = options;

  const start = e.ctx.currentTime + delay;
  const osc = e.ctx.createOscillator();
  const amp = e.ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (detune) osc.detune.setValueAtTime(detune, start);
  if (toFreq && toFreq !== freq) {
    // Exponential, because pitch is perceived logarithmically — a linear
    // sweep sounds like it slows down at the top.
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), start + attack + decay + hold);
  }

  let tail: AudioNode = amp;
  if (filter) {
    const biquad = e.ctx.createBiquadFilter();
    biquad.type = filter.type;
    biquad.frequency.setValueAtTime(filter.freq, start);
    if (filter.q) biquad.Q.setValueAtTime(filter.q, start);
    amp.connect(biquad);
    tail = biquad;
  }

  const peak = Math.max(0.0001, gain);
  const sustainLevel = Math.max(0.0001, peak * sustain);

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(peak, start + attack);
  amp.gain.exponentialRampToValueAtTime(sustainLevel, start + attack + decay);
  amp.gain.setValueAtTime(sustainLevel, start + attack + decay + hold);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay + hold + release);

  osc.connect(amp);
  tail.connect(bus === "music" ? e.music : e.sfx);

  osc.start(start);
  // The margin matters: stopping exactly at the end of the ramp can still
  // catch the tail on some implementations.
  osc.stop(start + attack + decay + hold + release + 0.05);
  osc.onended = () => {
    osc.disconnect();
    amp.disconnect();
  };
}

/**
 * Filtered noise — the basis of anything physical.
 *
 * Dice, shuffles, dominoes and card flips are all bursts of noise shaped by a
 * filter and an envelope; a pure tone cannot sound like an object.
 */
export function playNoise(options: {
  bus?: Bus;
  duration?: number;
  gain?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number };
  sweepTo?: number;
  delay?: number;
  attack?: number;
  release?: number;
}): void {
  const e = getEngine();
  if (!audible(e)) return;

  const {
    bus = "sfx",
    duration = 0.18,
    gain = 0.25,
    filter = { type: "bandpass" as BiquadFilterType, freq: 1800, q: 0.9 },
    sweepTo,
    delay = 0,
    attack = 0.005,
    release = 0.08,
  } = options;

  const start = e.ctx.currentTime + delay;
  const frames = Math.max(1, Math.floor(e.ctx.sampleRate * (duration + release)));
  const buffer = e.ctx.createBuffer(1, frames, e.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const source = e.ctx.createBufferSource();
  source.buffer = buffer;

  const biquad = e.ctx.createBiquadFilter();
  biquad.type = filter.type;
  biquad.frequency.setValueAtTime(filter.freq, start);
  if (filter.q) biquad.Q.setValueAtTime(filter.q, start);
  if (sweepTo) biquad.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), start + duration);

  const amp = e.ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration + release);

  source.connect(biquad);
  biquad.connect(amp);
  amp.connect(bus === "music" ? e.music : e.sfx);

  source.start(start);
  source.stop(start + duration + release + 0.05);
  source.onended = () => {
    source.disconnect();
    biquad.disconnect();
    amp.disconnect();
  };
}

/** Equal temperament from A4 = 440Hz, so chords are actually in tune. */
export function note(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

/** Named notes, for writing music readably. */
export const NOTE: Record<string, number> = {
  C3: note(-21), D3: note(-19), E3: note(-17), F3: note(-16), G3: note(-14), A3: note(-12), B3: note(-10),
  C4: note(-9), D4: note(-7), E4: note(-5), F4: note(-4), G4: note(-2), A4: note(0), B4: note(2),
  C5: note(3), D5: note(5), E5: note(7), F5: note(8), G5: note(10), A5: note(12), B5: note(14),
  C6: note(15), E6: note(19), G6: note(22),
};
