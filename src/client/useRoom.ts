"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, RoomSnapshot, ServerMessage } from "../platform/roomTypes";
import { getDeviceId } from "./deviceId";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "closed";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

/**
 * Where the room Worker lives.
 *
 * Falls back to the local `wrangler dev` address only when the page itself is
 * on localhost. A deployed build with no NEXT_PUBLIC_ROOM_WS_URL used to
 * silently dial 127.0.0.1 and hang on "connecting" forever; failing loudly
 * turns that into an obvious misconfiguration.
 */
export function roomWsBase(): string {
  const configured = process.env.NEXT_PUBLIC_ROOM_WS_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  if (host === "localhost" || host === "127.0.0.1" || host === "") return "ws://127.0.0.1:8787";
  throw new Error(
    "NEXT_PUBLIC_ROOM_WS_URL is not set. Point it at the deployed room Worker, e.g. wss://party-plus-room.<subdomain>.workers.dev"
  );
}

/** roomWsBase() throws when misconfigured; the UI still needs something to show. */
function safeServerUrl(): string {
  try {
    return roomWsBase();
  } catch {
    return "NEXT_PUBLIC_ROOM_WS_URL (not set)";
  }
}

export interface Room<TView = unknown> {
  status: ConnectionStatus;
  playerId: string;
  snapshot: RoomSnapshot<TView> | null;
  /** The module-redacted game state, or null in the lobby. */
  view: TView | null;
  error: string | null;
  /** Failed connection attempts since the last successful open. */
  failedAttempts: number;
  /** True once we've failed enough times that the server is probably down. */
  unreachable: boolean;
  /** Where we're trying to connect, so the UI can name it in an error. */
  serverUrl: string;
  isHost: boolean;
  isMyTurn: boolean;
  secondsLeft: number | null;
  nameOf: (id: string) => string;
  setName: (name: string) => void;
  selectGame: (gameId: string) => void;
  setGameOptions: (options: Record<string, unknown>) => void;
  setReady: (ready: boolean) => void;
  setSpectate: (spectate: boolean) => void;
  start: () => void;
  rematch: () => void;
  sendMove: (move: unknown) => void;
  sendChat: (text: string) => void;
  sendEmote: (emote: string) => void;
  /** Pushes an ephemeral frame (drawing strokes) to the rest of the room. */
  sendStream: (channel: string, data: unknown) => void;
  /** Subscribes to ephemeral frames from others. Returns an unsubscribe. */
  onStream: (handler: (frame: StreamFrame) => void) => () => void;
}

export interface StreamFrame {
  from: string;
  channel: string;
  data: unknown;
}

/**
 * Connection to a generic platform room.
 *
 * Game-agnostic by construction: it forwards opaque `move` payloads and
 * surfaces whatever `view` the server's active module produced. Adding a game
 * requires no change here.
 */
export function useRoom<TView = unknown>(code: string, displayName = ""): Room<TView> {
  const [playerId, setPlayerId] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [snapshot, setSnapshot] = useState<RoomSnapshot<TView> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const closedByUs = useRef(false);
  const nameRef = useRef(displayName);
  const streamHandlers = useRef(new Set<(frame: StreamFrame) => void>());

  useEffect(() => setPlayerId(getDeviceId()), []);

  useEffect(() => {
    if (!playerId) return;
    closedByUs.current = false;

    const connect = () => {
      const query = `playerId=${encodeURIComponent(playerId)}${
        nameRef.current ? `&name=${encodeURIComponent(nameRef.current)}` : ""
      }`;

      let ws: WebSocket;
      try {
        ws = new WebSocket(`${roomWsBase()}/room/${encodeURIComponent(code)}?${query}`);
      } catch (err) {
        // Misconfigured server URL, or the browser refused the socket. Surface
        // it as an unreachable server rather than throwing out of the effect
        // and blanking the page.
        setStatus("reconnecting");
        setFailedAttempts(attemptsRef.current + 1);
        setError(err instanceof Error ? err.message : "could not open a connection");
        const retry = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attemptsRef.current++);
        reconnectRef.current = setTimeout(connect, retry);
        return;
      }
      socketRef.current = ws;

      ws.onopen = () => {
        attemptsRef.current = 0;
        setFailedAttempts(0);
        setStatus("connected");
        setError(null);
        ws.send(JSON.stringify({ type: "hello", name: nameRef.current } satisfies ClientMessage));
      };

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (msg.type === "error") return setError(msg.message);
        // Stream frames arrive at pointer rates: hand them straight to the
        // subscriber rather than putting them through React state, which would
        // re-render the whole room for every stroke segment.
        if (msg.type === "stream") {
          for (const handler of streamHandlers.current) {
            handler({ from: msg.from, channel: msg.channel, data: msg.data });
          }
          return;
        }
        setError(null);
        setSnapshot(msg.snapshot as RoomSnapshot<TView>);
      };

      ws.onclose = () => {
        if (closedByUs.current) return;
        setStatus("reconnecting");
        setFailedAttempts(attemptsRef.current + 1);
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attemptsRef.current++);
        reconnectRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closedByUs.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      socketRef.current?.close();
      setStatus("closed");
    };
  }, [code, playerId]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return setError("Not connected to the room.");
    ws.send(JSON.stringify(msg));
  }, []);

  // Push a name change without tearing down the socket.
  useEffect(() => {
    nameRef.current = displayName;
    const ws = socketRef.current;
    if (displayName && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "setName", name: displayName } satisfies ClientMessage));
    }
  }, [displayName]);

  // Display-only countdown; the server owns and enforces the real deadline.
  useEffect(() => {
    if (!snapshot?.turnDeadline || snapshot.phase !== "playing") return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [snapshot?.turnDeadline, snapshot?.phase]);

  const secondsLeft =
    snapshot?.turnDeadline && snapshot.phase === "playing"
      ? Math.max(0, Math.ceil((snapshot.turnDeadline - now) / 1000))
      : null;

  const nameOf = useCallback(
    (id: string) =>
      snapshot?.members.find((m) => m.id === id)?.name ?? `Player ${id.slice(0, 4).toUpperCase()}`,
    [snapshot?.members]
  );

  return {
    status,
    playerId,
    snapshot,
    view: snapshot?.view ?? null,
    error,
    failedAttempts,
    // Two failures with nothing ever received means the room server isn't
    // answering — worth telling the player instead of spinning forever.
    unreachable: failedAttempts >= 2 && snapshot === null,
    serverUrl: safeServerUrl(),
    isHost: !!snapshot && snapshot.hostId === playerId,
    isMyTurn: !!snapshot && snapshot.currentPlayerId === playerId,
    secondsLeft,
    nameOf,
    setName: (name) => send({ type: "setName", name }),
    selectGame: (gameId) => send({ type: "selectGame", gameId }),
    setGameOptions: (options) => send({ type: "setGameOptions", options }),
    setReady: (ready) => send({ type: "ready", ready }),
    setSpectate: (spectate) => send({ type: "spectate", spectate }),
    start: () => send({ type: "start" }),
    rematch: () => send({ type: "rematch" }),
    sendMove: (move) => send({ type: "move", move }),
    sendChat: (text) => send({ type: "chat", text }),
    sendEmote: (emote) => send({ type: "emote", emote }),
    // Deliberately bypasses `send`: a dropped stroke frame is not worth an
    // error banner, and the next frame is milliseconds away.
    sendStream: (channel, data) => {
      const ws = socketRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stream", channel, data }));
    },
    onStream: (handler) => {
      streamHandlers.current.add(handler);
      return () => streamHandlers.current.delete(handler) as unknown as void;
    },
  };
}
