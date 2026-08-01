/// <reference types="@cloudflare/workers-types" />
import { getGame, listGames, requireGame } from "../platform/registry";
import "../games/index"; // side effect: registers built-in games
import type { AnyGameModule, GameEvent } from "../platform/types";
import type {
  ChatMessage,
  ClientMessage,
  Member,
  RoomPhase,
  RoomSnapshot,
  ServerMessage,
} from "../platform/roomTypes";
import { EMOTES, MAX_STREAM_BYTES } from "../platform/roomTypes";
import { createPackHydrator, type ContentEnv } from "../content/remote";
import { limitNameFor, SocketLimiter } from "../platform/rateLimit";

export interface Env extends ContentEnv {
  ROOM: DurableObjectNamespace;
  AUTH: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  /** Comma-separated origins allowed to open a socket; empty allows any. */
  ALLOWED_ORIGINS?: string;
  /**
   * HMAC secret for identity tokens. Optional: without it the auth object
   * generates one and keeps it, so a fresh deploy works with no setup — at the
   * cost of everyone being signed out if that object is ever wiped.
   */
  AUTH_SECRET?: string;
  /** Mail provider key. Unset means links are logged instead of sent. */
  RESEND_API_KEY?: string;
  /** From address, e.g. "Party Plus <no-reply@example.com>". */
  EMAIL_FROM?: string;
  /** Public URL of the web app, for building links in emails. */
  APP_URL?: string;
}

const MAX_MEMBERS = 12;
const MAX_NAME_LENGTH = 16;
const MAX_CHAT_LENGTH = 240;
const CHAT_HISTORY = 60;
const EVENT_HISTORY = 60;

/** How long a connected player may take before the room acts for them. */
export const TURN_LIMIT_MS = 45_000;
/** Grace for a player whose socket dropped — they may just be reloading. */
export const DISCONNECT_GRACE_MS = 8_000;

interface RoomStorage {
  code: string;
  /**
   * True once the room was deliberately created.
   *
   * Durable Objects spring into existence on first use, so before this flag a
   * probe for any code produced a real, empty room and there was no way to
   * tell a wrong guess from a right one. Joining now requires a room that
   * somebody created.
   */
  created: boolean;
  /** Who created it. Host by default, and the only one who can hand it over. */
  ownerId: string | null;
  /** Locked rooms admit nobody new — the host's answer to an unwanted joiner. */
  locked: boolean;
  /** Player ids the host has removed. They cannot come back. */
  banned: string[];
  gameId: string | null;
  /** Options passed to the module when a match starts (e.g. rules variant). */
  gameOptions: Record<string, unknown>;
  phase: RoomPhase;
  members: Member[];
  /** Seat order for the match in progress; a subset of member ids. */
  seats: string[];
  /** Opaque module state. The room engine never inspects this. */
  gameState: unknown;
  chat: ChatMessage[];
  events: GameEvent[];
  turnDeadline: number | null;
  winners: string[] | null;
  autoPlayed: string[];
  nextId: number;
}

function emptyRoom(code: string): RoomStorage {
  return {
    code,
    created: false,
    ownerId: null,
    locked: false,
    banned: [],
    gameId: null,
    gameOptions: {},
    phase: "lobby",
    members: [],
    seats: [],
    gameState: null,
    chat: [],
    events: [],
    turnDeadline: null,
    winners: null,
    autoPlayed: [],
    nextId: 1,
  };
}

/**
 * Generic multiplayer room.
 *
 * This class owns *people and plumbing* — membership, join-by-code, ready-up,
 * seating, the turn clock, reconnection grace, spectators, chat and emotes —
 * and contains no rules for any particular game. Everything rules-shaped is
 * delegated to the active GameModule, and the only state ever sent to a client
 * is whatever that module's getPlayerView returns for them.
 *
 * Adding a game means registering a module; this file should not need to change.
 */
export class RoomDO {
  private storage: DurableObjectStorage;
  private ctx: DurableObjectState;
  private cache: RoomStorage | null = null;

  /** Refreshes content packs from the data store, at most once a minute. */
  private hydrateContent: (now?: number) => Promise<unknown>;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.storage = ctx.storage;
    this.hydrateContent = createPackHydrator(env);
  }

  private async load(code = ""): Promise<RoomStorage> {
    if (this.cache) return this.cache;
    const stored = await this.storage.get<RoomStorage>("room");
    this.cache = stored ? { ...emptyRoom(code), ...stored } : emptyRoom(code);
    return this.cache;
  }

  private async save(room: RoomStorage): Promise<void> {
    this.cache = room;
    await this.storage.put("room", room);
  }

  private socketPlayerId(ws: WebSocket): string | null {
    return this.ctx.getTags(ws)[0] ?? null;
  }

  /**
   * Rate-limit state for one socket.
   *
   * Keyed by the socket object, so it dies with the connection and survives
   * hibernation the same way the socket does — a hibernated socket that wakes
   * up simply gets a fresh allowance, which is no worse than reconnecting.
   */
  private limiters = new WeakMap<WebSocket, SocketLimiter>();

  private limiterFor(ws: WebSocket): SocketLimiter {
    let limiter = this.limiters.get(ws);
    if (!limiter) this.limiters.set(ws, (limiter = new SocketLimiter()));
    return limiter;
  }

  private module(room: RoomStorage): AnyGameModule | null {
    return room.gameId ? getGame(room.gameId) : null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal routes, reachable only from the Worker in front of this object.
    if (url.pathname === "/__create") return this.create(request);
    if (url.pathname === "/__exists") return this.exists();

    /**
     * The player id is supplied by the Worker AFTER it has verified a signed
     * ticket — it is not a claim from the client any more. That was the hole:
     * anyone who knew your id could connect as you and be handed your hand,
     * your dice, your secret role.
     */
    const playerId = url.searchParams.get("playerId");
    const code = url.pathname.split("/").pop() ?? "";
    if (!playerId) return new Response("playerId required", { status: 400 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }

    const room = await this.load(code);
    if (!room.created) return new Response("no such room", { status: 404 });
    if (room.banned.includes(playerId)) return new Response("removed from this room", { status: 403 });
    // A locked room still lets its own members back in after a reload.
    if (room.locked && !room.members.some((m) => m.id === playerId)) {
      return new Response("room is locked", { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [playerId]);

    room.code = room.code || code;

    const name = sanitizeName(url.searchParams.get("name") ?? "");
    const existing = room.members.find((m) => m.id === playerId);

    if (existing) {
      existing.connected = true;
      if (name) existing.name = name;
      // Reconnecting restores the normal clock if it was their turn.
      if (this.currentPlayerId(room) === playerId) this.scheduleTurn(room);
    } else if (room.members.length < MAX_MEMBERS) {
      const member: Member = {
        id: playerId,
        name: name || `Player ${playerId.slice(0, 4).toUpperCase()}`,
        // Anyone arriving mid-match watches; they take a seat at the next match.
        seated: room.phase === "lobby",
        ready: false,
        connected: true,
        joinedAt: Date.now(),
      };
      room.members.push(member);
      // Use the resolved name: the client's stored name often arrives a beat
      // after the socket opens, and "someone joined" reads like a bug.
      this.pushSystem(room, `${member.name} joined`);
    } else {
      server.close(1008, "room full");
      return new Response(null, { status: 101, webSocket: client });
    }

    await this.save(room);
    this.broadcast(room);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const playerId = this.socketPlayerId(ws);
    if (!playerId) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.sendError(ws, "invalid message");
    }

    /**
     * Per-connection rate limiting, in memory.
     *
     * Deliberately not a Durable Object hop: this is the hot path, and a
     * drawing pushes dozens of frames a second. Each message type has its own
     * bucket, so chat spam cannot starve the moves of the player next to them.
     */
    const limiter = this.limiterFor(ws);
    const verdict = limiter.check(limitNameFor(msg.type));
    if (!verdict.allowed) {
      if (limiter.abusive) {
        // Long past "enthusiastic". Close it; the ticket endpoint rate limits
        // how quickly they can come back.
        ws.close(1008, "too many messages");
        return;
      }
      // Stream frames are fire-and-forget; an error per dropped frame would
      // itself be a flood.
      if (msg.type !== "stream") {
        this.sendError(ws, `slow down — try again in ${Math.ceil(verdict.retryAfterMs / 1000)}s`);
      }
      return;
    }

    const room = await this.load();
    const me = room.members.find((m) => m.id === playerId);
    if (!me) return this.sendError(ws, "you are not in this room");
    const isHost = this.hostId(room) === playerId;

    /** Player ids whose sockets to close once everyone has the final state. */
    const closeAfterBroadcast: string[] = [];

    switch (msg.type) {
      case "hello":
        if (msg.name) me.name = sanitizeName(msg.name) || me.name;
        break;

      case "setName": {
        const next = sanitizeName(msg.name);
        if (!next) return this.sendError(ws, "name cannot be empty");
        me.name = next;
        break;
      }

      case "selectGame": {
        if (!isHost) return this.sendError(ws, "only the host can choose the game");
        if (!getGame(msg.gameId)) return this.sendError(ws, `unknown game: ${msg.gameId}`);

        const module = requireGame(msg.gameId);
        /**
         * Switching mid-match is allowed on purpose.
         *
         * Making people leave and rebuild the room to play something else is
         * the kind of friction that ends an evening — everyone loses the code,
         * someone does not come back. So the match is abandoned in place and
         * the room, with all of its people, stays exactly where it is.
         */
        const abandoning = room.phase !== "lobby";
        if (abandoning) {
          room.phase = "lobby";
          room.gameState = null;
          room.winners = null;
          room.seats = [];
          room.events = [];
          room.turnDeadline = null;
          room.autoPlayed = [];
          void this.storage.deleteAlarm();
        }

        room.gameId = msg.gameId;
        room.gameOptions = {};
        // Changing game invalidates readiness — people agreed to a different game.
        for (const m of room.members) m.ready = false;

        const benched = this.applySeatLimit(room, module.meta.maxPlayers);
        this.pushSystem(
          room,
          abandoning
            ? `host switched to ${module.meta.name} — the match was abandoned`
            : `game set to ${module.meta.name}`
        );
        if (benched.length > 0) {
          this.pushSystem(
            room,
            `${module.meta.name} seats ${module.meta.maxPlayers}, so ${benched.join(", ")} ${
              benched.length === 1 ? "is" : "are"
            } spectating`
          );
        }
        break;
      }

      case "setGameOptions": {
        if (!isHost) return this.sendError(ws, "only the host can change the rules");
        if (room.phase !== "lobby") return this.sendError(ws, "a match is already under way");
        if (typeof msg.options !== "object" || msg.options === null) {
          return this.sendError(ws, "invalid options");
        }
        room.gameOptions = { ...room.gameOptions, ...msg.options };
        // Different rules is a different game as far as consent goes.
        for (const m of room.members) m.ready = false;
        break;
      }

      case "spectate":
        if (room.phase !== "lobby") return this.sendError(ws, "can only change seat in the lobby");
        me.seated = !msg.spectate;
        if (!me.seated) me.ready = false;
        break;

      case "ready":
        if (!me.seated) return this.sendError(ws, "spectators do not ready up");
        me.ready = msg.ready;
        break;

      case "start":
      case "rematch": {
        // Deal time is the moment fresh content matters, and the only moment
        // it is worth waiting for. A content store that is down or slow must
        // not stop the match, so failures here are swallowed on purpose.
        await this.hydrateContent().catch(() => null);
        const err = this.startMatch(room, playerId, msg.type);
        if (err) return this.sendError(ws, err);
        break;
      }

      case "move": {
        const err = this.applyMove(room, playerId, msg.move);
        if (err) return this.sendError(ws, err);
        break;
      }

      /**
       * Live relay. Handled here and returned early on purpose: a stroke frame
       * must not touch storage or rebuild a snapshot for every member, or the
       * drawing would arrive at a few frames a second.
       */
      case "stream":
        this.relayStream(room, playerId, ws, msg.channel, msg.data);
        return;

      case "chat": {
        const text = String(msg.text ?? "").slice(0, MAX_CHAT_LENGTH).trim();
        if (!text) return;
        this.pushChat(room, { playerId, kind: "chat", text });
        break;
      }

      case "emote": {
        if (!(EMOTES as readonly string[]).includes(msg.emote)) return;
        this.pushChat(room, { playerId, kind: "emote", text: msg.emote });
        break;
      }

      /**
       * Signalling for a peer-to-peer call.
       *
       * Addressed to exactly one player rather than broadcast: an offer meant
       * for one peer is noise to everyone else, and a mesh of a dozen people
       * would multiply that noise by twelve. Returned early — signalling does
       * not change room state, so it needs neither a save nor a snapshot.
       */
      case "voice": {
        if (typeof msg.to !== "string") return;
        if (!room.members.some((m) => m.id === msg.to)) return;
        const payload = JSON.stringify({ type: "voice", from: playerId, signal: msg.signal });
        // Size cap: an SDP is a few KB, so anything much larger is not
        // signalling and has no business being relayed.
        if (payload.length > MAX_STREAM_BYTES) return;
        for (const socket of this.ctx.getWebSockets()) {
          if (this.socketPlayerId(socket) === msg.to) socket.send(payload);
        }
        return;
      }

      case "voiceState": {
        me.voice = { joined: !!msg.joined, muted: !!msg.muted };
        break;
      }

      /**
       * Back to the lobby, which is how the group changes game.
       *
       * The room, its members, the chat and the voice call all survive — only
       * the match ends. Without this the only way to play something else was
       * for everyone to leave and rebuild the room around a new code.
       */
      case "backToLobby": {
        if (!isHost) return this.sendError(ws, "only the host can change the game");
        if (room.phase === "lobby") return;
        room.phase = "lobby";
        room.gameState = null;
        room.winners = null;
        room.seats = [];
        room.events = [];
        room.autoPlayed = [];
        room.turnDeadline = null;
        for (const m of room.members) m.ready = false;
        void this.storage.deleteAlarm();
        this.pushSystem(room, "back to the lobby — the host is choosing a game");
        break;
      }

      case "lock": {
        if (!isHost) return this.sendError(ws, "only the host can lock the room");
        room.locked = !!msg.locked;
        this.pushSystem(room, room.locked ? "room locked — no new players" : "room unlocked");
        break;
      }

      case "kick": {
        if (!isHost) return this.sendError(ws, "only the host can remove players");
        if (msg.playerId === playerId) return this.sendError(ws, "you cannot remove yourself");
        const target = room.members.find((m) => m.id === msg.playerId);
        if (!target) return this.sendError(ws, "no such player");

        room.members = room.members.filter((m) => m.id !== msg.playerId);
        room.seats = room.seats.filter((id) => id !== msg.playerId);
        // Banned rather than merely removed: otherwise they reconnect in a
        // second and the host has achieved nothing.
        if (!room.banned.includes(msg.playerId)) room.banned.push(msg.playerId);
        this.pushSystem(room, `${target.name} was removed`);
        // Closed after the broadcast below, not here: the person being removed
        // should receive the final state — including the system message saying
        // what happened — before their socket goes away.
        closeAfterBroadcast.push(msg.playerId);
        break;
      }

      default:
        return this.sendError(ws, "unknown message");
    }

    await this.save(room);
    this.broadcast(room);

    for (const id of closeAfterBroadcast) {
      for (const socket of this.ctx.getWebSockets()) {
        if (this.socketPlayerId(socket) === id) socket.close(1008, "removed from the room");
      }
    }
  }

  /**
   * Trims the seated players to what the new game can hold.
   *
   * Nobody is removed from the room — a game with fewer seats turns the extras
   * into spectators, which is a seat they can take back at the next switch.
   * Longest-present members keep their seats, so switching to a two-player
   * game does not hand it to whoever happened to join last.
   *
   * Returns the names moved to spectating, for the message in the chat.
   */
  private applySeatLimit(room: RoomStorage, maxPlayers: number): string[] {
    const seated = room.members
      .filter((m) => m.seated)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (seated.length <= maxPlayers) return [];

    const benched = seated.slice(maxPlayers);
    for (const member of benched) {
      member.seated = false;
      member.ready = false;
    }
    return benched.map((m) => m.name);
  }

  /** Starts (or restarts) a match. Returns an error string, or null on success. */
  private startMatch(room: RoomStorage, playerId: string, kind: "start" | "rematch"): string | null {
    if (this.hostId(room) !== playerId) return "only the host can start the match";
    if (kind === "start" && room.phase === "playing") return "a match is already under way";
    if (kind === "rematch" && room.phase !== "finished") return "the current match is still running";
    if (!room.gameId) return "pick a game first";

    const module = requireGame(room.gameId);
    // Offline members keep their membership but do not hold up a start.
    const players = room.members.filter((m) => m.seated && m.connected);
    const { minPlayers, maxPlayers, name } = module.meta;
    if (players.length < minPlayers) return `${name} needs at least ${minPlayers} players`;
    if (players.length > maxPlayers) return `${name} allows at most ${maxPlayers} players`;
    if (kind === "start" && !players.every((p) => p.ready)) return "everyone must be ready";

    room.seats = players.map((p) => p.id);
    room.gameState = module.createInitialState(room.seats, room.gameOptions);
    room.phase = "playing";
    room.winners = null;
    room.autoPlayed = [];
    room.events = [];
    for (const m of room.members) m.ready = false;
    this.pushSystem(room, `${name} started with ${room.seats.length} players`);
    this.scheduleTurn(room);
    return null;
  }

  /** Applies a player move through the module. Returns an error string or null. */
  private applyMove(room: RoomStorage, playerId: string, move: unknown): string | null {
    if (room.phase !== "playing") return "no match in progress";
    const module = this.module(room);
    if (!module) return "no game module loaded";
    if (!room.seats.includes(playerId)) return "spectators cannot play";

    if (!module.validateMove(room.gameState, playerId, move)) return "illegal move";

    const { state, events } = module.applyMove(room.gameState, playerId, move);
    room.gameState = state;
    room.events = [...room.events, ...events].slice(-EVENT_HISTORY);
    room.autoPlayed = room.autoPlayed.filter((id) => id !== playerId);

    const win = module.checkWinCondition(state);
    if (win?.finished) {
      room.phase = "finished";
      room.winners = win.winners;
      room.turnDeadline = null;
      void this.storage.deleteAlarm();
    } else {
      this.scheduleTurn(room);
    }
    return null;
  }

  /**
   * Creates the room. Called once, by the Worker, on POST /rooms.
   *
   * Idempotent for the same owner so a retried request is harmless, but it
   * will not quietly re-own an existing room.
   */
  private async create(request: Request): Promise<Response> {
    const { code, ownerId } = (await request.json().catch(() => ({}))) as {
      code?: string;
      ownerId?: string;
    };
    if (!code || !ownerId) return new Response("code and ownerId required", { status: 400 });

    const room = await this.load(code);
    if (room.created) {
      // Astronomically unlikely with 32^8 codes, but a collision must not
      // silently drop someone into a stranger's room.
      return Response.json({ created: false, reason: "already exists" }, { status: 409 });
    }
    room.created = true;
    room.code = code;
    room.ownerId = ownerId;
    await this.save(room);
    return Response.json({ created: true, code });
  }

  /** Does this room exist? The only oracle for a code, and rate limited. */
  private async exists(): Promise<Response> {
    const room = await this.load();
    return Response.json({
      exists: room.created,
      locked: room.locked,
      members: room.members.length,
      phase: room.phase,
      gameId: room.gameId,
    });
  }

  /**
   * Forwards one ephemeral frame to everybody else.
   *
   * Three refusals, all of them cheap, because this runs at pointer-event
   * rates: the game must have opted into a relay at all, the module must
   * authorise this player on this channel right now, and the frame must be
   * small. Rejections are silent — an error per frame would be a flood, and
   * the only way to get here unauthorised is a client bug or an attempt to
   * scribble on someone else's turn.
   */
  private relayStream(
    room: RoomStorage,
    playerId: string,
    from: WebSocket,
    channel: string,
    data: unknown
  ): void {
    if (room.phase !== "playing") return;
    const module = this.module(room);
    if (!module?.authorizeStream) return;
    if (typeof channel !== "string" || channel.length > 32) return;
    if (!room.seats.includes(playerId)) return;
    if (!module.authorizeStream(room.gameState, playerId, channel, data)) return;

    const payload = JSON.stringify({ type: "stream", from: playerId, channel, data });
    if (payload.length > MAX_STREAM_BYTES) return;

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === from) continue;
      ws.send(payload);
    }
  }

  /**
   * A dropped socket must not strand the table. The seat is kept so the player
   * can reconnect into their own hidden state, but the clock keeps running and
   * the alarm will play for them.
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    const playerId = this.socketPlayerId(ws);
    if (!playerId) return;
    const room = await this.load();
    const member = room.members.find((m) => m.id === playerId);
    if (!member) return;

    /**
     * A player is only offline once ALL of their sockets have gone.
     *
     * On a refresh or an in-app navigation the browser opens the new socket
     * before the old one's close event lands, so unconditionally clearing the
     * flag here marked a player offline while they were sitting there
     * connected — which also blocked the match from starting, since starting
     * only counts connected seats.
     */
    const stillOpen = this.ctx
      .getWebSockets()
      .some((other) => other !== ws && this.socketPlayerId(other) === playerId);
    if (stillOpen) return;

    member.connected = false;
    member.ready = false;
    // Their peer connections died with the socket; leaving the badge up would
    // show a call that is not there.
    if (member.voice) member.voice = { joined: false, muted: member.voice.muted };

    // Membership deliberately survives a dropped socket, even in the lobby.
    // Removing people on disconnect meant a momentary blip cost the host their
    // room — host is simply the first member, so dropping them silently handed
    // the room to whoever was next. Offline members are excluded from the
    // ready check instead (see startMatch), so they cannot block a start.
    if (this.currentPlayerId(room) === playerId) {
      room.turnDeadline = Date.now() + DISCONNECT_GRACE_MS;
      void this.storage.setAlarm(room.turnDeadline);
    }

    await this.save(room);
    this.broadcast(room);
  }

  /**
   * Turn clock expiry: the player forfeits their turn.
   *
   * Running out of time costs you the turn — the server does not commit you to
   * a move you never chose. Only games that genuinely cannot skip a player
   * (Liar's Dice needs a bid or a challenge before play can continue) fall
   * back to a stand-in move.
   *
   * The clock is only ever armed for the player who still has to act, and
   * every applied move re-arms it for whoever is next, so a player who has
   * already moved is never left waiting on their own expired countdown.
   */
  async alarm(): Promise<void> {
    const room = await this.load();
    if (room.phase !== "playing" || room.turnDeadline === null) return;
    if (Date.now() < room.turnDeadline - 50) {
      // Someone acted (or reconnected) and pushed the deadline out; re-arm
      // rather than firing against a stale one.
      await this.storage.setAlarm(room.turnDeadline);
      return;
    }

    const module = this.module(room);
    if (!module) return;

    // A timed phase that has expired takes priority: the module advances its
    // own machine and the room engine merely relays the result.
    const phaseDeadline = module.getPhaseDeadline?.(room.gameState) ?? null;
    if (phaseDeadline !== null && Date.now() >= phaseDeadline - 50) {
      const advanced = module.advancePhase?.(room.gameState, Date.now()) ?? null;
      if (advanced) {
        room.gameState = advanced.state;
        room.events = [...room.events, ...advanced.events].slice(-EVENT_HISTORY);
        const win = module.checkWinCondition(advanced.state);
        if (win?.finished) {
          room.phase = "finished";
          room.winners = win.winners;
          room.turnDeadline = null;
          void this.storage.deleteAlarm();
        } else {
          this.scheduleTurn(room);
        }
        await this.save(room);
        this.broadcast(room);
        return;
      }
    }

    const actor = this.currentPlayerId(room);
    if (!actor) return;

    // Preferred path: skip them and move on.
    const forfeited = module.forfeitTurn?.(room.gameState, actor) ?? null;
    if (forfeited !== null) {
      room.gameState = forfeited;
      room.events = [
        ...room.events,
        { type: "timeout", playerId: actor, text: "ran out of time — turn forfeited" },
      ].slice(-EVENT_HISTORY);
      if (!room.autoPlayed.includes(actor)) room.autoPlayed.push(actor);

      const win = module.checkWinCondition(forfeited);
      if (win?.finished) {
        room.phase = "finished";
        room.winners = win.winners;
        room.turnDeadline = null;
        void this.storage.deleteAlarm();
      } else {
        this.scheduleTurn(room);
      }
      await this.save(room);
      this.broadcast(room);
      return;
    }

    // Fallback for games where a turn cannot simply be skipped.
    const move = module.getTimeoutMove?.(room.gameState, actor) ?? null;
    if (move === null) {
      // No safe default at all; hold the state and re-arm so the room does not
      // spin, but also does not corrupt the match.
      this.scheduleTurn(room);
      await this.save(room);
      return;
    }

    const error = this.applyMove(room, actor, move);
    if (!error && !room.autoPlayed.includes(actor)) room.autoPlayed.push(actor);
    await this.save(room);
    this.broadcast(room);
  }

  /**
   * Host is the longest-present *connected* member.
   *
   * Anchoring it to members[0] regardless of connection meant that if the host
   * closed their tab the room deadlocked: nobody else could start or pick a
   * game, and the host was never coming back. Migration only considers
   * connected members, so a brief blip does not hand the room away while the
   * original host is still there.
   */
  private hostId(room: RoomStorage): string | null {
    return (room.members.find((m) => m.connected) ?? room.members[0])?.id ?? null;
  }

  private currentPlayerId(room: RoomStorage): string | null {
    if (room.phase !== "playing") return null;
    const module = this.module(room);
    return module ? module.getCurrentPlayerId(room.gameState) : null;
  }

  private scheduleTurn(room: RoomStorage): void {
    // A game with timed phases (Werewolf's night) owns its own clock; wake on
    // whichever comes first, its phase deadline or the player's turn limit.
    const module = this.module(room);
    const phaseDeadline = module?.getPhaseDeadline?.(room.gameState) ?? null;

    const actor = this.currentPlayerId(room);
    if (!actor && phaseDeadline !== null) {
      room.turnDeadline = phaseDeadline;
      void this.storage.setAlarm(phaseDeadline);
      return;
    }
    if (!actor) {
      room.turnDeadline = null;
      void this.storage.deleteAlarm();
      return;
    }
    const member = room.members.find((m) => m.id === actor);
    const limit = member?.connected === false ? DISCONNECT_GRACE_MS : TURN_LIMIT_MS;
    const turnDeadline = Date.now() + limit;
    room.turnDeadline =
      phaseDeadline !== null ? Math.min(turnDeadline, phaseDeadline) : turnDeadline;
    void this.storage.setAlarm(room.turnDeadline);
  }

  private pushChat(room: RoomStorage, msg: Omit<ChatMessage, "id" | "at">): void {
    room.chat = [...room.chat, { ...msg, id: room.nextId++, at: Date.now() }].slice(-CHAT_HISTORY);
  }

  private pushSystem(room: RoomStorage, text: string): void {
    this.pushChat(room, { playerId: "", kind: "system", text });
  }

  /**
   * Builds this recipient's snapshot.
   *
   * The module's getPlayerView is the ONLY path by which game state reaches a
   * client — `room.gameState` is never serialised here. A spectator who never
   * held a seat is passed null so modules can distinguish them from players.
   */
  private snapshotFor(room: RoomStorage, playerId: string): RoomSnapshot {
    const module = this.module(room);
    const isPlaying = room.seats.includes(playerId);
    const view =
      module && room.gameState !== null
        ? module.getPlayerView(room.gameState, isPlaying ? playerId : null)
        : null;

    return {
      code: room.code,
      phase: room.phase,
      gameId: room.gameId,
      gameMeta: module?.meta ?? null,
      hostId: this.hostId(room),
      members: room.members,
      chat: room.chat,
      events: room.events,
      view,
      currentPlayerId: this.currentPlayerId(room),
      turnDeadline: room.turnDeadline,
      winners: room.winners,
      youArePlaying: isPlaying,
      autoPlayed: room.autoPlayed,
      catalog: listGames(),
      gameOptions: room.gameOptions,
      // Resolved per snapshot, not cached: content packs can be added to the
      // store while a lobby sits open, and the picker should show them.
      optionGroups: module?.listOptionGroups?.() ?? [],
      locked: room.locked,
    };
  }

  /**
   * Sends to one socket, tolerating a dead one.
   *
   * A socket can close between the moment the room decides to broadcast and
   * the moment it writes — a player closing their tab is exactly that race,
   * and kicking someone guarantees it. Without this guard the throw escaped
   * the message handler mid-broadcast and everyone *after* the dead socket in
   * the list silently missed that update.
   */
  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Gone. The close handler will tidy up the membership.
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, { type: "error", message });
  }

  private broadcast(room: RoomStorage): void {
    for (const ws of this.ctx.getWebSockets()) {
      const playerId = this.socketPlayerId(ws);
      if (!playerId) continue;
      this.send(ws, { type: "snapshot", snapshot: this.snapshotFor(room, playerId) });
    }
  }
}

function sanitizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}
