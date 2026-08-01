"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  getEngine,
  loadSettings,
  saveSettings,
  setBusVolume,
  unlock,
  type AudioSettings,
} from "./engine";
import { isMusicRunning, startMusic, stopMusic } from "./music";
import { play as playSfx, type SoundName } from "./sfx";

interface AudioApi extends AudioSettings {
  /** True once a gesture has let the browser start audio. */
  ready: boolean;
  play: (name: SoundName) => void;
  setMusicOn: (on: boolean) => void;
  setSfxOn: (on: boolean) => void;
  setMusicVolume: (value: number) => void;
  setSfxVolume: (value: number) => void;
}

const AudioContextApi = createContext<AudioApi | null>(null);

/**
 * Audio for the whole platform.
 *
 * Browsers refuse to start audio before a user gesture, so the first click,
 * key press or touch anywhere unlocks it — no "click here to enable sound"
 * gate, which is a step nobody should have to take.
 *
 * Every preference is persisted, because being asked to turn the music off
 * twice is worse than never having had music.
 */
export function AudioProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    setSettings(loadSettings());
    loaded.current = true;
  }, []);

  // One-time unlock on the first interaction of any kind.
  useEffect(() => {
    let done = false;
    const onGesture = async () => {
      if (done) return;
      done = true;
      const ok = await unlock();
      setReady(ok);
      if (ok && loadSettings().musicOn) startMusic();
      for (const event of ["pointerdown", "keydown", "touchstart"]) {
        window.removeEventListener(event, onGesture);
      }
    };
    for (const event of ["pointerdown", "keydown", "touchstart"]) {
      window.addEventListener(event, onGesture, { passive: true });
    }
    return () => {
      for (const event of ["pointerdown", "keydown", "touchstart"]) {
        window.removeEventListener(event, onGesture);
      }
    };
  }, []);

  // Pause the music when the tab is hidden: nobody wants a background tab
  // playing at them, and it is wasted battery.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stopMusic();
      else if (settings.musicOn && ready) startMusic();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [settings.musicOn, ready]);

  const update = useCallback((patch: Partial<AudioSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      setBusVolume("music", next.musicOn ? next.musicVolume : 0);
      setBusVolume("sfx", next.sfxOn ? next.sfxVolume : 0);
      if (next.musicOn && !isMusicRunning() && getEngine()?.ctx.state === "running") startMusic();
      if (!next.musicOn) stopMusic();
      return next;
    });
  }, []);

  const api = useMemo<AudioApi>(
    () => ({
      ...settings,
      ready,
      play: (name) => {
        if (settings.sfxOn) playSfx(name);
      },
      setMusicOn: (on) => update({ musicOn: on }),
      setSfxOn: (on) => update({ sfxOn: on }),
      setMusicVolume: (musicVolume) => update({ musicVolume }),
      setSfxVolume: (sfxVolume) => update({ sfxVolume }),
    }),
    [settings, ready, update]
  );

  return <AudioContextApi.Provider value={api}>{children}</AudioContextApi.Provider>;
}

/** Safe outside a provider (tests, isolated renders): audio simply does nothing. */
export function useAudio(): AudioApi {
  return (
    useContext(AudioContextApi) ?? {
      ...DEFAULT_SETTINGS,
      ready: false,
      play: () => {},
      setMusicOn: () => {},
      setSfxOn: () => {},
      setMusicVolume: () => {},
      setSfxVolume: () => {},
    }
  );
}
