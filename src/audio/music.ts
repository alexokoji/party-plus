"use client";

import { getEngine, playVoice } from "./engine";

/**
 * The background music.
 *
 * Generated rather than streamed, which decides most of its character: there
 * is no file to download, no loop point to hear coming round again, and it can
 * run for an hour without repeating. It is written to be ignorable — this
 * plays under people talking to each other, and music that demands attention
 * during a party game is music people turn off.
 *
 * A slow chord cycle, a soft bass note per chord, and occasional bell notes
 * from the chord's own scale so nothing can land wrong.
 */

/** ii–V–I–vi in C, the most unobtrusive progression there is. */
const PROGRESSION: number[][] = [
  [-9, -5, -2, 3], // C major
  [-7, -4, 0, 5], // D minor
  [-2, 2, 5, 10], // G major
  [-4, 0, 3, 7], // A minor
];

const hz = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12);

/** Seconds per chord. Slow enough that the change is a mood, not an event. */
const CHORD_SECONDS = 7.5;

let timer: ReturnType<typeof setTimeout> | null = null;
let step = 0;
let running = false;

function scheduleChord(): void {
  const engine = getEngine();
  if (!engine || !running) return;

  const chord = PROGRESSION[step % PROGRESSION.length]!;
  step += 1;

  // The pad: each chord tone as a long, soft, slightly detuned pair. The long
  // attack and release are what make it a pad rather than an organ stab, and
  // they overlap the next chord so the change is never abrupt.
  chord.forEach((semitone, i) => {
    for (const detune of [-6, 6]) {
      playVoice({
        bus: "music",
        type: "sine",
        freq: hz(semitone),
        detune,
        gain: 0.09 - i * 0.008,
        attack: 1.6,
        decay: 1.2,
        sustain: 0.72,
        hold: CHORD_SECONDS - 3.2,
        release: 2.4,
        filter: { type: "lowpass", freq: 2200, q: 0.5 },
      });
    }
  });

  // Bass, an octave and a half below the root.
  playVoice({
    bus: "music",
    type: "triangle",
    freq: hz(chord[0]! - 12),
    gain: 0.1,
    attack: 0.9,
    decay: 1.4,
    sustain: 0.6,
    hold: CHORD_SECONDS - 3,
    release: 1.8,
    filter: { type: "lowpass", freq: 700, q: 0.6 },
  });

  // One or two bell notes, chosen from this chord so they cannot clash.
  const bells = Math.random() < 0.65 ? 2 : 1;
  for (let i = 0; i < bells; i++) {
    const semitone = chord[Math.floor(Math.random() * chord.length)]! + 12;
    playVoice({
      bus: "music",
      type: "triangle",
      freq: hz(semitone),
      gain: 0.05,
      delay: 1 + Math.random() * (CHORD_SECONDS - 2.5),
      attack: 0.05,
      decay: 0.6,
      sustain: 0.35,
      hold: 0.3,
      release: 1.6,
    });
  }

  timer = setTimeout(scheduleChord, CHORD_SECONDS * 1000);
}

export function startMusic(): void {
  if (running) return;
  const engine = getEngine();
  if (!engine || engine.ctx.state !== "running") return;
  running = true;
  scheduleChord();
}

/**
 * Stops scheduling.
 *
 * Notes already scheduled are left to finish their release rather than being
 * cut — silence should arrive as a fade, which is what stopping music sounds
 * like when it is done properly.
 */
export function stopMusic(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

export const isMusicRunning = () => running;
