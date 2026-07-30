import type { GameEvent, GameMeta, GameOptionGroup } from "./types";

export type RoomPhase = "lobby" | "playing" | "finished";

export interface Member {
  id: string;
  name: string;
  /** Seated players play; spectators watch. Eliminated players stay seated. */
  seated: boolean;
  ready: boolean;
  connected: boolean;
  /** Order of arrival; seat order for games that care. */
  joinedAt: number;
}

export interface ChatMessage {
  id: number;
  playerId: string;
  /** "chat" is free text, "emote" is one of a fixed set. */
  kind: "chat" | "emote" | "system";
  text: string;
  at: number;
}

/** What a single client receives. `view` is the module's redacted state. */
export interface RoomSnapshot<TView = unknown> {
  code: string;
  phase: RoomPhase;
  gameId: string | null;
  gameMeta: GameMeta | null;
  hostId: string | null;
  members: Member[];
  chat: ChatMessage[];
  /** Recent module events, for activity feeds and animation cues. */
  events: GameEvent[];
  /** Module-redacted state for this recipient; null in the lobby. */
  view: TView | null;
  currentPlayerId: string | null;
  turnDeadline: number | null;
  winners: string[] | null;
  /** True when this recipient holds a seat in the current match. */
  youArePlaying: boolean;
  /** Seats the server auto-played for after a timeout. */
  autoPlayed: string[];
  /** Games available to pick in the lobby. */
  catalog: GameMeta[];
  /** Options (e.g. rules variant) the host chose for the next match. */
  gameOptions: Record<string, unknown>;
  /**
   * Extra choices the selected game offers right now (content packs and the
   * like), resolved per snapshot so runtime-loaded content appears live.
   */
  optionGroups: GameOptionGroup[];
  /** True when the host has closed the room to new players. */
  locked: boolean;
}

export type ClientMessage =
  | { type: "hello"; name?: string }
  | { type: "setName"; name: string }
  | { type: "selectGame"; gameId: string }
  | { type: "setGameOptions"; options: Record<string, unknown> }
  | { type: "ready"; ready: boolean }
  | { type: "spectate"; spectate: boolean }
  | { type: "start" }
  | { type: "rematch" }
  | { type: "move"; move: unknown }
  | { type: "chat"; text: string }
  | { type: "emote"; emote: string }
  /**
   * Ephemeral, high-frequency data (drawing strokes, cursors).
   *
   * Deliberately separate from "move": stream frames are relayed to the other
   * players and then forgotten — never persisted, never folded into game state,
   * and never used to decide anything. A game must opt in by implementing
   * authorizeStream, so no module gets an open relay by accident.
   */
  | { type: "stream"; channel: string; data: unknown }
  /** Host only: stop admitting new players. */
  | { type: "lock"; locked: boolean }
  /** Host only: remove someone, and keep them out. */
  | { type: "kick"; playerId: string };

export type ServerMessage =
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "stream"; from: string; channel: string; data: unknown }
  | { type: "error"; message: string };

/** Largest stream frame the room will relay, in bytes of JSON. */
export const MAX_STREAM_BYTES = 16 * 1024;

export const EMOTES = ["👍", "😂", "😱", "🤔", "🔥", "🎲", "🤥", "👀"] as const;
export type Emote = (typeof EMOTES)[number];
