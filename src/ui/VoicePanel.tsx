"use client";

import { useEffect, useMemo } from "react";
import { useAudio } from "../audio/AudioProvider";
import { MESH_LIMIT, useVoiceChat } from "../client/useVoiceChat";
import type { Member } from "../platform/roomTypes";

export interface VoicePanelProps {
  playerId: string;
  members: Member[];
  nameOf: (id: string) => string;
  sendVoice: (to: string, signal: unknown) => void;
  onVoice: (handler: (from: string, signal: unknown) => void) => () => void;
  announceVoice: (joined: boolean, muted: boolean) => void;
}

/**
 * Talking to the room.
 *
 * Opt-in and nothing else: the microphone is untouched until somebody presses
 * Join, and the button says exactly what it will do. Everyone can see who is
 * on the call and who is muted, because a voice call where you cannot tell
 * whether you are being heard is worse than no call at all.
 */
export function VoicePanel({
  playerId,
  members,
  nameOf,
  sendVoice,
  onVoice,
  announceVoice,
}: VoicePanelProps) {
  const audio = useAudio();

  // Everyone who has announced themselves on the call.
  const peerIds = useMemo(
    () => members.filter((m) => m.voice?.joined && m.connected && m.id !== playerId).map((m) => m.id),
    [members, playerId]
  );

  const voice = useVoiceChat({
    playerId,
    peerIds,
    send: sendVoice,
    subscribe: (handler) => onVoice((from, signal) => handler(from, signal as never)),
    announce: announceVoice,
  });

  /**
   * Music gets out of the way of people.
   *
   * Background music at talking volume makes a call tiring, so it drops while
   * the call is live and comes back when it ends.
   */
  useEffect(() => {
    if (!voice.joined) return;
    const previous = audio.musicVolume;
    audio.setMusicVolume(Math.min(previous, 0.07));
    return () => audio.setMusicVolume(previous);
    // Only on join/leave: reacting to volume changes would fight the slider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.joined]);

  const onCall = members.filter((m) => m.voice?.joined && m.connected);
  const statusOf = (id: string) => voice.peers.find((p) => p.id === id);
  const crowded = onCall.length > MESH_LIMIT;

  return (
    <section className="card-panel voice-panel">
      <div className="voice-head">
        <h3>Voice{onCall.length > 0 ? ` · ${onCall.length}` : ""}</h3>
        <div className="voice-actions">
          {voice.joined ? (
            <>
              <button
                type="button"
                className={`voice-mic${voice.muted ? " muted" : ""}`}
                aria-pressed={voice.muted}
                onClick={() => voice.setMuted(!voice.muted)}
              >
                {voice.muted ? "🔇 Muted" : "🎙 Live"}
              </button>
              <button type="button" className="ghost" onClick={voice.leave}>
                Leave
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void voice.join()} disabled={voice.connecting}>
              {voice.connecting ? "Asking…" : "🎙 Join voice"}
            </button>
          )}
        </div>
      </div>

      {!voice.joined && !voice.error && (
        <p className="hint">Talk to the room. Your microphone is only used after you join.</p>
      )}
      {voice.error && <p className="error-note">{voice.error}</p>}
      {crowded && voice.joined && (
        <p className="hint">
          {onCall.length} people on a peer-to-peer call is a lot for a phone — expect it to get
          patchy.
        </p>
      )}

      {onCall.length > 0 && (
        <ul className="voice-list">
          {onCall.map((member) => {
            const isMe = member.id === playerId;
            const peer = statusOf(member.id);
            const speaking = isMe ? voice.speaking : peer?.speaking;
            const muted = member.voice?.muted;
            return (
              <li
                key={member.id}
                className={`voice-person${speaking && !muted ? " speaking" : ""}${
                  peer?.status === "failed" ? " failed" : ""
                }`}
              >
                <span className="voice-dot" aria-hidden="true" />
                <span className="voice-name">
                  {nameOf(member.id)}
                  {isMe ? " (you)" : ""}
                </span>
                <span className="voice-state">
                  {muted
                    ? "muted"
                    : isMe || peer?.status === "live"
                      ? speaking
                        ? "speaking"
                        : ""
                      : peer?.status === "failed"
                        ? "couldn't connect"
                        : "connecting…"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {voice.peers.some((p) => p.status === "failed") && (
        <p className="hint">
          Some networks block direct connections. Those calls need a relay server, which this
          deployment does not have.
        </p>
      )}
    </section>
  );
}
