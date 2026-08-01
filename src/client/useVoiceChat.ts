"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice chat, peer to peer.
 *
 * Audio goes directly between browsers; the room server only carries the
 * handshake. A Durable Object forwarding live media would add a round trip to
 * every packet, bill for all of it, and still sound worse — so it does not.
 *
 * The trade-off of a mesh is that everyone sends their voice to everyone: at
 * N people each uploads N-1 streams. That is comfortable to about six, heavy
 * beyond eight on a phone, which is why `MESH_LIMIT` exists and says so out
 * loud rather than quietly sounding terrible.
 *
 * The microphone is requested when the player presses join, and at no other
 * time.
 */

/** Public STUN only. See `iceServers` below for what this does not cover. */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

/** Above this many people on the call, a mesh stops being kind to phones. */
export const MESH_LIMIT = 8;

export type PeerStatus = "connecting" | "live" | "failed";

export interface VoicePeer {
  id: string;
  status: PeerStatus;
  /** True while they are actually making sound. */
  speaking: boolean;
}

export interface VoiceChat {
  joined: boolean;
  muted: boolean;
  /** Set when the browser or the person refused the microphone. */
  error: string | null;
  /** True while waiting for the microphone permission prompt. */
  connecting: boolean;
  peers: VoicePeer[];
  /** True when this player is making sound, for their own indicator. */
  speaking: boolean;
  join: () => Promise<void>;
  leave: () => void;
  setMuted: (muted: boolean) => void;
}

interface Signal {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  /** Sent when a peer leaves, so the other side tears down immediately. */
  bye?: boolean;
}

interface Peer {
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser?: AnalyserNode;
  /** Perfect negotiation: exactly one side yields when offers collide. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

export interface VoiceChatOptions {
  playerId: string;
  /** Everyone currently in the room who has joined voice. */
  peerIds: string[];
  send: (to: string, signal: Signal) => void;
  /** Subscribes to signalling addressed to us. Returns an unsubscribe. */
  subscribe: (handler: (from: string, signal: Signal) => void) => () => void;
  /** Tells the room we are on the call, so others know to connect. */
  announce: (joined: boolean, muted: boolean) => void;
}

export function useVoiceChat(options: VoiceChatOptions): VoiceChat {
  const { playerId, peerIds, send, subscribe, announce } = options;

  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<VoicePeer[]>([]);
  const [speaking, setSpeaking] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, Peer>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const joinedRef = useRef(false);

  const updatePeer = useCallback((id: string, patch: Partial<VoicePeer>) => {
    setPeers((current) => {
      const existing = current.find((p) => p.id === id);
      if (!existing) return [...current, { id, status: "connecting", speaking: false, ...patch }];
      return current.map((p) => (p.id === id ? { ...p, ...patch } : p));
    });
  }, []);

  /** Builds (or returns) the connection to one peer. */
  const peerFor = useCallback(
    (id: string): Peer => {
      const existing = peersRef.current.get(id);
      if (existing) return existing;

      const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      // A stable, symmetric rule for who yields: both sides compute the same
      // answer from the two ids, so exactly one of them is polite.
      const peer: Peer = {
        connection,
        audio: new Audio(),
        polite: playerId < id,
        makingOffer: false,
        ignoreOffer: false,
      };
      peer.audio.autoplay = true;

      for (const track of streamRef.current?.getTracks() ?? []) {
        connection.addTrack(track, streamRef.current!);
      }

      connection.onicecandidate = ({ candidate }) => {
        if (candidate) send(id, { candidate: candidate.toJSON() });
      };

      connection.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await connection.setLocalDescription();
          send(id, { description: connection.localDescription!.toJSON() });
        } catch {
          /* the connection is closing; nothing useful to do */
        } finally {
          peer.makingOffer = false;
        }
      };

      connection.onconnectionstatechange = () => {
        const state = connection.connectionState;
        if (state === "connected") updatePeer(id, { status: "live" });
        // Reported rather than hidden: without a TURN server a minority of
        // networks cannot be traversed at all, and a silent failure looks
        // like the other person choosing not to talk.
        if (state === "failed" || state === "closed") updatePeer(id, { status: "failed" });
      };

      connection.ontrack = ({ streams }) => {
        const [remote] = streams;
        if (!remote) return;
        peer.audio.srcObject = remote;
        void peer.audio.play().catch(() => {
          /* autoplay policy; the element plays after the next gesture */
        });

        // Speaking detection, so the UI can show who is talking.
        try {
          const ctx = (audioCtxRef.current ??= new AudioContext());
          const source = ctx.createMediaStreamSource(remote);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          peer.analyser = analyser;
        } catch {
          /* analysis is a nicety; the call still works without it */
        }
      };

      peersRef.current.set(id, peer);
      updatePeer(id, { status: "connecting" });
      return peer;
    },
    [playerId, send, updatePeer]
  );

  const dropPeer = useCallback((id: string) => {
    const peer = peersRef.current.get(id);
    if (!peer) return;
    peer.connection.onicecandidate = null;
    peer.connection.ontrack = null;
    peer.connection.onnegotiationneeded = null;
    peer.connection.close();
    peer.audio.srcObject = null;
    peersRef.current.delete(id);
    setPeers((current) => current.filter((p) => p.id !== id));
  }, []);

  /** Incoming signalling. Perfect negotiation, so simultaneous offers settle. */
  useEffect(() => {
    return subscribe(async (from, signal) => {
      if (!joinedRef.current) return;
      if (signal.bye) return dropPeer(from);

      const peer = peerFor(from);
      const { connection } = peer;
      try {
        if (signal.description) {
          const offerCollision =
            signal.description.type === "offer" &&
            (peer.makingOffer || connection.signalingState !== "stable");
          peer.ignoreOffer = !peer.polite && offerCollision;
          if (peer.ignoreOffer) return;

          await connection.setRemoteDescription(signal.description);
          if (signal.description.type === "offer") {
            await connection.setLocalDescription();
            send(from, { description: connection.localDescription!.toJSON() });
          }
        } else if (signal.candidate) {
          try {
            await connection.addIceCandidate(signal.candidate);
          } catch {
            // Expected while an offer we chose to ignore is still in flight.
            if (!peer.ignoreOffer) throw new Error("bad candidate");
          }
        }
      } catch {
        updatePeer(from, { status: "failed" });
      }
    });
  }, [subscribe, peerFor, dropPeer, send, updatePeer]);

  // Connect to whoever is on the call, and drop whoever left.
  useEffect(() => {
    if (!joined) return;
    const wanted = peerIds.filter((id) => id !== playerId).slice(0, MESH_LIMIT);
    // Both sides may open the connection and both may offer; the polite/
    // impolite rule above is precisely what makes that safe, so there is no
    // need to elect an initiator.
    for (const id of wanted) {
      if (!peersRef.current.has(id)) peerFor(id);
    }
    for (const id of [...peersRef.current.keys()]) {
      if (!wanted.includes(id)) dropPeer(id);
    }
  }, [joined, peerIds, playerId, peerFor, dropPeer]);

  // Who is talking, sampled a few times a second rather than per frame.
  useEffect(() => {
    if (!joined) return;
    let last = 0;
    const loop = (time: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (time - last < 120) return;
      last = time;

      const data = new Uint8Array(256);
      for (const [id, peer] of peersRef.current) {
        if (!peer.analyser) continue;
        peer.analyser.getByteTimeDomainData(data);
        updatePeer(id, { speaking: loudness(data) > 0.045 });
      }
      const own = ownAnalyser.current;
      if (own) {
        own.getByteTimeDomainData(data);
        setSpeaking(!muted && loudness(data) > 0.045);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [joined, muted, updatePeer]);

  const ownAnalyser = useRef<AnalyserNode | null>(null);

  const join = useCallback(async () => {
    if (joinedRef.current || connecting) return;
    setConnecting(true);
    setError(null);
    try {
      // The one and only place the microphone is requested.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      streamRef.current = stream;

      try {
        const ctx = (audioCtxRef.current ??= new AudioContext());
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        ownAnalyser.current = analyser;
      } catch {
        /* own-voice indicator only */
      }

      joinedRef.current = true;
      setJoined(true);
      announce(true, false);
    } catch (e) {
      const name = (e as { name?: string }).name;
      setError(
        name === "NotAllowedError"
          ? "Microphone permission was refused. Voice needs it; nothing else does."
          : name === "NotFoundError"
            ? "No microphone found."
            : "Could not start the microphone."
      );
    } finally {
      setConnecting(false);
    }
  }, [announce, connecting]);

  const leave = useCallback(() => {
    joinedRef.current = false;
    for (const id of [...peersRef.current.keys()]) {
      send(id, { bye: true });
      dropPeer(id);
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    ownAnalyser.current = null;
    setJoined(false);
    setSpeaking(false);
    announce(false, false);
  }, [announce, dropPeer, send]);

  const changeMute = useCallback(
    (next: boolean) => {
      setMuted(next);
      // Disabling the track is what actually silences it — the browser then
      // sends nothing, rather than sending silence.
      for (const track of streamRef.current?.getAudioTracks() ?? []) track.enabled = !next;
      if (joinedRef.current) announce(true, next);
    },
    [announce]
  );

  // Tidy up if the component goes away while still on the call.
  useEffect(() => {
    return () => {
      for (const [, peer] of peersRef.current) peer.connection.close();
      peersRef.current.clear();
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    };
  }, []);

  return {
    joined,
    muted,
    error,
    connecting,
    peers,
    speaking,
    join,
    leave,
    setMuted: changeMute,
  };
}

/** RMS of a waveform, 0..1. Cheap enough to run several times a second. */
export function loudness(samples: Uint8Array): number {
  let sum = 0;
  for (const sample of samples) {
    const centred = (sample - 128) / 128;
    sum += centred * centred;
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/**
 * Which side yields when two peers offer at the same moment.
 *
 * Both compute it from the same two ids, so they always disagree about who is
 * polite — which is the point.
 */
export function isPolite(self: string, other: string): boolean {
  return self < other;
}
