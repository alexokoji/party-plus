"use client";

import { NOTE, playNoise, playVoice } from "./engine";

/**
 * The sound effects.
 *
 * Each one is a small arrangement of synthesised voices rather than a sample,
 * and every voice ends on a release ramp — a sound here cannot be "cut off"
 * because there is no recording to truncate and no gain is ever snapped to
 * zero.
 *
 * The design rule throughout: physical events (dice, cards, tiles, pieces) are
 * shaped NOISE, because objects are broadband; informational events (correct,
 * wrong, your turn, win) are TONES, because pitch is what carries meaning.
 * Mixing those up is what makes game audio sound like a phone menu.
 */

export type SoundName =
  | "diceRoll"
  | "diceLand"
  | "cardPlay"
  | "cardDraw"
  | "cardFlip"
  | "shuffle"
  | "chipBet"
  | "pieceMove"
  | "pieceCapture"
  | "tokenStep"
  | "slideDown"
  | "climbUp"
  | "tilePlace"
  | "correct"
  | "wrong"
  | "reveal"
  | "clue"
  | "yourTurn"
  | "turnPass"
  | "timerWarning"
  | "win"
  | "lose"
  | "join"
  | "leave"
  | "chat"
  | "start"
  | "eliminate"
  | "nightFall"
  | "dayBreak"
  | "penStroke"
  | "uiTap";

type Recipe = () => void;

const RECIPES: Record<SoundName, Recipe> = {
  /** Tumbling: several noise bursts, closer together as the die slows. */
  diceRoll: () => {
    const times = [0, 0.075, 0.135, 0.185, 0.225];
    times.forEach((t, i) => {
      playNoise({
        delay: t,
        duration: 0.045,
        gain: 0.16 - i * 0.02,
        filter: { type: "bandpass", freq: 2600 - i * 260, q: 1.4 },
      });
    });
  },
  diceLand: () => {
    playNoise({ duration: 0.06, gain: 0.2, filter: { type: "bandpass", freq: 900, q: 1.1 }, sweepTo: 380 });
    playVoice({ freq: NOTE.G3!, type: "triangle", gain: 0.1, attack: 0.004, decay: 0.05, sustain: 0.2, hold: 0, release: 0.16 });
  },

  /** A card landing: a short paper slap with almost no pitch. */
  cardPlay: () => {
    playNoise({ duration: 0.055, gain: 0.22, filter: { type: "bandpass", freq: 2100, q: 0.8 }, sweepTo: 900, release: 0.09 });
  },
  cardDraw: () => {
    playNoise({ duration: 0.09, gain: 0.15, filter: { type: "highpass", freq: 1400, q: 0.6 }, sweepTo: 3200, release: 0.1 });
  },
  cardFlip: () => {
    playNoise({ duration: 0.04, gain: 0.18, filter: { type: "bandpass", freq: 3000, q: 1.2 }, release: 0.07 });
  },
  shuffle: () => {
    for (let i = 0; i < 7; i++) {
      playNoise({
        delay: i * 0.045,
        duration: 0.035,
        gain: 0.1,
        filter: { type: "bandpass", freq: 1800 + Math.random() * 1400, q: 1 },
        release: 0.06,
      });
    }
  },

  /** Clay chips: a click with a short ring under it. */
  chipBet: () => {
    playNoise({ duration: 0.03, gain: 0.16, filter: { type: "bandpass", freq: 4200, q: 2 }, release: 0.05 });
    playVoice({ freq: NOTE.E5!, type: "triangle", gain: 0.07, attack: 0.002, decay: 0.03, sustain: 0.2, hold: 0, release: 0.1, delay: 0.01 });
  },

  pieceMove: () => {
    playNoise({ duration: 0.05, gain: 0.14, filter: { type: "lowpass", freq: 1200, q: 0.7 }, sweepTo: 600, release: 0.08 });
  },
  /** A capture should feel like one object displacing another. */
  pieceCapture: () => {
    playNoise({ duration: 0.05, gain: 0.2, filter: { type: "bandpass", freq: 1500, q: 0.9 }, sweepTo: 500, release: 0.09 });
    playVoice({ freq: NOTE.C4!, toFreq: NOTE.G3!, type: "triangle", gain: 0.12, attack: 0.004, decay: 0.06, sustain: 0.3, hold: 0.02, release: 0.2, delay: 0.02 });
  },
  tokenStep: () => {
    playNoise({ duration: 0.028, gain: 0.11, filter: { type: "bandpass", freq: 2400, q: 1.6 }, release: 0.05 });
  },

  /** Snakes: a long fall. Ladders: the same shape, upwards. */
  slideDown: () => {
    playVoice({ freq: NOTE.A4!, toFreq: NOTE.D3!, type: "sine", gain: 0.16, attack: 0.01, decay: 0.1, sustain: 0.7, hold: 0.34, release: 0.3 });
    playNoise({ duration: 0.45, gain: 0.06, filter: { type: "bandpass", freq: 1200, q: 0.6 }, sweepTo: 300, release: 0.18 });
  },
  climbUp: () => {
    [0, 1, 2, 3].forEach((i) =>
      playVoice({
        freq: NOTE.C4! * Math.pow(2, i / 12) * (1 + i * 0.06),
        type: "triangle",
        gain: 0.11,
        delay: i * 0.075,
        attack: 0.006,
        decay: 0.05,
        sustain: 0.4,
        hold: 0.02,
        release: 0.16,
      })
    );
  },
  tilePlace: () => {
    playNoise({ duration: 0.04, gain: 0.2, filter: { type: "bandpass", freq: 1500, q: 1.4 }, sweepTo: 700, release: 0.08 });
    playVoice({ freq: NOTE.A3!, type: "triangle", gain: 0.09, attack: 0.003, decay: 0.04, sustain: 0.25, hold: 0, release: 0.14 });
  },

  /** A rising third — the interval everyone reads as "yes". */
  correct: () => {
    playVoice({ freq: NOTE.E5!, type: "triangle", gain: 0.16, attack: 0.008, decay: 0.06, sustain: 0.6, hold: 0.04, release: 0.22 });
    playVoice({ freq: NOTE.G5!, type: "triangle", gain: 0.13, delay: 0.09, attack: 0.008, decay: 0.06, sustain: 0.6, hold: 0.05, release: 0.28 });
  },
  /** A falling minor second, soft enough not to feel like a punishment. */
  wrong: () => {
    playVoice({ freq: NOTE.E4!, type: "sine", gain: 0.14, attack: 0.01, decay: 0.08, sustain: 0.5, hold: 0.04, release: 0.24 });
    playVoice({ freq: NOTE.D4! * 0.97, type: "sine", gain: 0.12, delay: 0.1, attack: 0.01, decay: 0.08, sustain: 0.5, hold: 0.06, release: 0.3 });
  },
  reveal: () => {
    playVoice({ freq: NOTE.C5!, type: "triangle", gain: 0.12, attack: 0.01, decay: 0.07, sustain: 0.5, hold: 0.03, release: 0.26 });
    playVoice({ freq: NOTE.G5!, type: "sine", gain: 0.08, delay: 0.05, attack: 0.012, decay: 0.08, sustain: 0.5, hold: 0.04, release: 0.3 });
  },
  clue: () => {
    playVoice({ freq: NOTE.D5!, type: "triangle", gain: 0.12, attack: 0.01, decay: 0.06, sustain: 0.55, hold: 0.03, release: 0.24 });
    playVoice({ freq: NOTE.A5!, type: "sine", gain: 0.07, delay: 0.07, attack: 0.01, decay: 0.07, sustain: 0.5, hold: 0.03, release: 0.26 });
  },

  /** Your turn: a two-note call, warm rather than shrill. */
  yourTurn: () => {
    playVoice({ freq: NOTE.G4!, type: "triangle", gain: 0.15, attack: 0.012, decay: 0.07, sustain: 0.6, hold: 0.05, release: 0.26 });
    playVoice({ freq: NOTE.C5!, type: "triangle", gain: 0.14, delay: 0.11, attack: 0.012, decay: 0.07, sustain: 0.6, hold: 0.06, release: 0.34 });
  },
  turnPass: () => {
    playVoice({ freq: NOTE.E4!, type: "sine", gain: 0.08, attack: 0.012, decay: 0.06, sustain: 0.4, hold: 0.02, release: 0.2 });
  },
  timerWarning: () => {
    playVoice({ freq: NOTE.B4!, type: "triangle", gain: 0.11, attack: 0.006, decay: 0.05, sustain: 0.4, hold: 0.02, release: 0.18 });
  },

  /** A major arpeggio, allowed to ring properly. */
  win: () => {
    [NOTE.C5!, NOTE.E5!, NOTE.G5!, NOTE.C6!].forEach((freq, i) =>
      playVoice({
        freq,
        type: "triangle",
        gain: 0.16 - i * 0.012,
        delay: i * 0.11,
        attack: 0.012,
        decay: 0.09,
        sustain: 0.62,
        hold: i === 3 ? 0.32 : 0.06,
        release: i === 3 ? 0.85 : 0.3,
      })
    );
  },
  lose: () => {
    [NOTE.G4!, NOTE.E4!, NOTE.C4!].forEach((freq, i) =>
      playVoice({
        freq,
        type: "sine",
        gain: 0.13,
        delay: i * 0.14,
        attack: 0.014,
        decay: 0.1,
        sustain: 0.55,
        hold: i === 2 ? 0.24 : 0.05,
        release: i === 2 ? 0.7 : 0.28,
      })
    );
  },

  join: () => {
    playVoice({ freq: NOTE.C5!, type: "sine", gain: 0.1, attack: 0.01, decay: 0.05, sustain: 0.5, hold: 0.02, release: 0.2 });
    playVoice({ freq: NOTE.E5!, type: "sine", gain: 0.08, delay: 0.07, attack: 0.01, decay: 0.05, sustain: 0.5, hold: 0.02, release: 0.24 });
  },
  leave: () => {
    playVoice({ freq: NOTE.E5!, toFreq: NOTE.C5!, type: "sine", gain: 0.09, attack: 0.01, decay: 0.07, sustain: 0.5, hold: 0.03, release: 0.26 });
  },
  chat: () => {
    playVoice({ freq: NOTE.A5!, type: "sine", gain: 0.06, attack: 0.006, decay: 0.04, sustain: 0.35, hold: 0.01, release: 0.16 });
  },
  start: () => {
    [NOTE.C4!, NOTE.G4!, NOTE.C5!].forEach((freq, i) =>
      playVoice({ freq, type: "triangle", gain: 0.14, delay: i * 0.1, attack: 0.012, decay: 0.08, sustain: 0.6, hold: 0.06, release: 0.36 })
    );
  },
  eliminate: () => {
    playVoice({ freq: NOTE.A4!, toFreq: NOTE.D3!, type: "sawtooth", gain: 0.1, attack: 0.01, decay: 0.12, sustain: 0.5, hold: 0.1, release: 0.4, filter: { type: "lowpass", freq: 1400, q: 0.8 } });
  },

  /** Werewolf phases: one dark and one bright, both slow. */
  nightFall: () => {
    playVoice({ freq: NOTE.D3!, type: "sine", gain: 0.14, attack: 0.06, decay: 0.2, sustain: 0.6, hold: 0.35, release: 0.7, filter: { type: "lowpass", freq: 900, q: 0.7 } });
    playVoice({ freq: NOTE.A3!, type: "sine", gain: 0.08, delay: 0.12, attack: 0.08, decay: 0.2, sustain: 0.5, hold: 0.3, release: 0.7 });
  },
  dayBreak: () => {
    [NOTE.G4!, NOTE.B4!, NOTE.D5!].forEach((freq, i) =>
      playVoice({ freq, type: "triangle", gain: 0.1, delay: i * 0.09, attack: 0.05, decay: 0.12, sustain: 0.6, hold: 0.2, release: 0.55 })
    );
  },

  penStroke: () => {
    playNoise({ duration: 0.05, gain: 0.05, filter: { type: "bandpass", freq: 3600, q: 1.8 }, release: 0.06 });
  },
  uiTap: () => {
    playVoice({ freq: NOTE.E5!, type: "sine", gain: 0.05, attack: 0.004, decay: 0.03, sustain: 0.3, hold: 0, release: 0.12 });
  },
};

/** Plays a named effect. Unknown names are ignored rather than throwing. */
export function play(name: SoundName): void {
  RECIPES[name]?.();
}

export const SOUND_NAMES = Object.keys(RECIPES) as SoundName[];
