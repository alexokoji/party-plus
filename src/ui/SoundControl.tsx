"use client";

import { useState } from "react";
import { useAudio } from "../audio/AudioProvider";

/**
 * Music and effects controls.
 *
 * Collapsed to two buttons by default: the two questions people actually have
 * are "make it stop" and "make it quieter", and the second one only after the
 * first has not worked. Volumes live behind the sliders toggle.
 */
export function SoundControl() {
  const audio = useAudio();
  const [open, setOpen] = useState(false);

  return (
    <div className={`sound-control${open ? " open" : ""}`}>
      <button
        type="button"
        className="sound-toggle"
        aria-pressed={audio.musicOn}
        title={audio.musicOn ? "Turn music off" : "Turn music on"}
        onClick={() => audio.setMusicOn(!audio.musicOn)}
      >
        {audio.musicOn ? "🎵" : "🔇"}
      </button>
      <button
        type="button"
        className="sound-toggle"
        aria-pressed={audio.sfxOn}
        title={audio.sfxOn ? "Turn sound effects off" : "Turn sound effects on"}
        onClick={() => audio.setSfxOn(!audio.sfxOn)}
      >
        {audio.sfxOn ? "🔊" : "🔈"}
      </button>
      <button
        type="button"
        className="sound-toggle small"
        aria-expanded={open}
        title="Volume"
        onClick={() => setOpen(!open)}
      >
        ⚙
      </button>

      {open && (
        <div className="sound-sliders">
          <label>
            <span>Music</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(audio.musicVolume * 100)}
              onChange={(e) => audio.setMusicVolume(Number(e.target.value) / 100)}
            />
          </label>
          <label>
            <span>Effects</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(audio.sfxVolume * 100)}
              onChange={(e) => audio.setSfxVolume(Number(e.target.value) / 100)}
            />
          </label>
          {!audio.ready && <p className="hint">Sound starts after your first tap.</p>}
        </div>
      )}
    </div>
  );
}
