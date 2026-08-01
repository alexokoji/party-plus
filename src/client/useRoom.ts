"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, RoomSnapshot, ServerMessage } from "../platform/roomTypes";
import { ensureIdentity, roomTicket } from "./identity";
import { roomWsBase, safeServerUrl } from "./roomUrl";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "closed";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

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
  /** Host only: end the match and return everyone to the game picker. */
  backToLobby: () => void;
  /** Host only: close the room to new players. */
  lock: (locked: boolean) => void;
  /** Host only: remove someone and keep them out. */
  kick: (playerId: string) => void;
  sendChat: (text: string) => void;
  sendEmote: (emote: string) => void;
  /** Pushes an ephemeral frame (drawing strokes) to the rest of the room. */
  sendStream: (channel: string, data: unknown) => void;
  /** Subscribes to ephemeral frames from others. Returns an unsubscribe. */
  onStream: (handler: (frame: StreamFrame) => void) => () => void;
  /** Sends WebRTC signalling to one other player. */
  sendVoice: (to: string, signal: unknown) => void;
  /** Subscribes to signalling addressed to us. Returns an unsubscribe. */
  onVoice: (handler: (from: string, signal: unknown) => void) => () => void;
  /** Publishes voice presence so others know to connect. */
  announceVoice: (joined: boolean, muted: boolean) => void;
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
  const voiceHandlers = useRef(new Set<(from: string, signal: unknown) => void>());

  const tokenRef = useRef("");

  // Identity first: the socket cannot be opened without a signed ticket, and a
  // ticket needs a verified identity to be issued against.
  useEffect(() => {
    let cancelled = false;
    ensureIdentity()
      .then(({ account, token }) => {
        if (cancelled) return;
        tokenRef.current = token;
        if (!nameRef.current) nameRef.current = account.name;
        setPlayerId(account.id);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "could not sign in");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!playerId) return;
    closedByUs.current = false;

    const connect = async () => {
      let ws: WebSocket;
      try {
        // One short-lived, room-scoped ticket per connection. It is what the
        // server verifies instead of believing a player id in the query.
        const ticket = await roomTicket(code, tokenRef.current, nameRef.current);
        if (closedByUs.current) return;
        ws = new WebSocket(
          `${roomWsBase()}/room/${encodeURIComponent(code)}?ticket=${encodeURIComponent(ticket)}`
        );
      } catch (err) {
        // Misconfigured server URL, or the browser refused the socket. Surface
        // it as an unreachable server rather than throwing out of the effect
        // and blanking the page.
        setStatus("reconnecting");
        setFailedAttempts(attemptsRef.current + 1);
        setError(err instanceof Error ? err.message : "could not open a connection");
        const retry = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attemptsRef.current++);
        reconnectRef.current = setTimeout(() => void connect(), retry);
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
        if (msg.type === "voice") {
          // Straight to the peer-connection layer: signalling is latency
          // sensitive and has nothing to do with React state.
          for (const handler of voiceHandlers.current) handler(msg.from, msg.signal);
          return;
        }
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
        reconnectRef.current = setTimeout(() => void connect(), delay);
      };

      ws.onerror = () => ws.close();
    };

    void connect();
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
    backToLobby: () => send({ type: "backToLobby" }),
    lock: (locked) => send({ type: "lock", locked }),
    kick: (id) => send({ type: "kick", playerId: id }),
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
    sendVoice: (to, signal) => {
      const ws = socketRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "voice", to, signal }));
    },
    onVoice: (handler) => {
      voiceHandlers.current.add(handler);
      return () => voiceHandlers.current.delete(handler) as unknown as void;
    },
    announceVoice: (joined, muted) => send({ type: "voiceState", joined, muted }),
  };
}
