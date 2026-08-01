/**
 * Platform contracts shared by the room engine and every game module.
 *
 * The room Durable Object knows nothing about any specific game. It owns
 * people (membership, seats, chat, reconnection) and delegates every rules
 * question to the active GameModule.
 */

/**
 * A selectable rules variant. Games whose rules differ by region or house
 * style advertise them here so the lobby can offer a picker generically —
 * the room engine passes the chosen id straight back as a game option.
 */
export interface GameVariantMeta {
  id: string;
  name: string;
  description: string;
}

/**
 * A set of choices the lobby offers for one game option.
 *
 * Unlike `variants`, these are resolved when the lobby is rendered rather than
 * baked into the module's meta, because the choices can change while the
 * Worker runs — content packs are loaded from a data store, so a pack added
 * five minutes ago has to appear in the picker without a deploy.
 */
export interface GameOptionGroup {
  /** The key the chosen id is passed back under, in gameOptions. */
  key: string;
  name: string;
  description?: string;
  options: Array<{ id: string; name: string; description: string }>;
}

/**
 * Shelves in the gallery.
 *
 * The platform started as party games and is not staying that way, so a game
 * says where it belongs rather than the gallery keeping a list — otherwise
 * every new game means editing the hub.
 */
export type GameCategory = "party" | "board" | "card" | "puzzle" | "arcade";

/**
 * How a game can be played.
 *
 * "room" needs other people and a Durable Object. "solo" runs entirely in the
 * browser against bots or a puzzle, costs nothing to serve, and needs no
 * account — which is what makes it the way most people will arrive.
 */
export type GameMode = "solo" | "room";

export interface GameMeta {
  id: string;
  name: string;
  /** One-line pitch for the gallery. */
  tagline: string;
  /** Which shelf it sits on. Defaults to party for the original thirteen. */
  category?: GameCategory;
  /** Ways to play it. Defaults to room-only. */
  modes?: GameMode[];
  minPlayers: number;
  maxPlayers: number;
  /** Optional rules variants a room may choose between. */
  variants?: GameVariantMeta[];
  /** Option key the chosen variant id is passed under. Defaults to "variant". */
  variantOptionKey?: string;
  /**
   * True when some state must never reach other players (hands, dice, secret
   * roles). The room engine uses this to refuse to broadcast anything but
   * per-player views for such games — a game that lies here would leak.
   */
  hasHiddenState: boolean;
  /** Rough minutes per match, for the gallery card. */
  estimatedMinutes?: number;
}

/**
 * Something that happened, emitted by a module for clients to narrate or
 * animate. Events are public by construction: never put hidden state in one.
 */
export interface GameEvent {
  type: string;
  /** Who caused it, when that makes sense. */
  playerId?: string;
  /** Human-readable line for the activity feed. */
  text?: string;
  /** Public payload — must be safe for every recipient, including spectators. */
  data?: Record<string, unknown>;
}

export interface WinCondition {
  finished: boolean;
  winners: string[];
}

export interface ApplyResult<TState> {
  state: TState;
  events: GameEvent[];
}

/**
 * A pluggable game.
 *
 * Implementations must be pure with respect to `state`: given the same state
 * and move they must produce the same result, and they must not mutate the
 * state passed in. The room engine relies on this to persist, replay and
 * redact state safely.
 *
 * @typeParam TState - full authoritative state, including hidden information
 * @typeParam TMove  - a move as sent by a client
 * @typeParam TView  - the redacted state a single player is allowed to see
 */
export interface GameModule<TState = unknown, TMove = unknown, TView = unknown> {
  meta: GameMeta;

  /** Deals a fresh match for exactly these players, in seat order. */
  createInitialState(players: string[], options?: GameOptions): TState;

  /** Cheap legality check. Must not throw on malformed input. */
  validateMove(state: TState, playerId: string, move: TMove): boolean;

  /**
   * Applies a legal move. Callers must validate first; implementations should
   * still guard, and may throw for a move that fails validation.
   */
  applyMove(state: TState, playerId: string, move: TMove): ApplyResult<TState>;

  /**
   * The only thing the server is allowed to send a client.
   *
   * Must strip every piece of information `playerId` is not entitled to.
   * `playerId` is null for pure spectators who never held a seat.
   */
  getPlayerView(state: TState, playerId: string | null): TView;

  /** Null while the match is still running. */
  checkWinCondition(state: TState): WinCondition | null;

  /**
   * Who must act next, or null if nobody in particular.
   *
   * The room engine owns seating and the turn *clock*, but only the game
   * knows whose turn it is — in Liar's Dice, for instance, the player who
   * lost the last challenge opens the next round rather than the next seat.
   */
  getCurrentPlayerId(state: TState): string | null;

  /**
   * When this game's own clock next needs attention, as epoch ms.
   *
   * Turn-based games leave this alone — the room engine's per-turn clock is
   * enough. Games with timed *phases* (a Werewolf night that ends whether or
   * not everyone acted) return their phase deadline, and the room engine wakes
   * up to call advancePhase. Returning null means "nothing scheduled".
   */
  getPhaseDeadline?(state: TState): number | null;

  /**
   * Advance a timed phase whose deadline has passed.
   *
   * The module owns the phase machine entirely; the room engine only supplies
   * the wake-up. Return null to leave the state alone.
   */
  advancePhase?(state: TState, now: number): ApplyResult<TState> | null;

  /**
   * Skip this player's turn entirely when their clock runs out.
   *
   * Preferred over getTimeoutMove: a player who runs out of time should lose
   * their turn, not have the server commit them to a move they didn't choose.
   * Return null when the game has no meaningful "skip" — Liar's Dice cannot
   * advance without a bid or a challenge, for instance — and the room engine
   * will fall back to getTimeoutMove.
   */
  forfeitTurn?(state: TState, playerId: string): TState | null;

  /**
   * A move to make on behalf of someone who ran out of time or vanished.
   *
   * Only used when the game cannot simply skip the player (see forfeitTurn).
   * Returning null tells the room engine it has no safe default and it should
   * leave the state alone.
   */
  getTimeoutMove?(state: TState, playerId: string): TMove | null;

  /** Players knocked out but still watching. */
  getEliminatedPlayers?(state: TState): string[];

  /**
   * May this player push data on this ephemeral channel right now?
   *
   * Implementing this opts the game into the room's live relay (drawing
   * strokes, cursors). Frames are forwarded to the other players and then
   * dropped: they are never persisted and never affect game state, so this is
   * purely an authorisation question — "is it your turn to draw?".
   *
   * Games that do not implement it have no relay at all, which is the safe
   * default: an open channel is a way to pass hidden information around the
   * game's own rules.
   */
  authorizeStream?(state: TState, playerId: string, channel: string, data: unknown): boolean;

  /**
   * Extra lobby choices beyond the rules variant, resolved at display time.
   *
   * Used for content packs, whose list is not known when the module is
   * written. Returning them here rather than in `meta` is what lets a pack
   * pushed into the content store show up in an open lobby.
   */
  listOptionGroups?(): GameOptionGroup[];
}

export interface GameOptions {
  seed?: number;
  [key: string]: unknown;
}

/** Convenience alias for a module whose type parameters are unknown. */
export type AnyGameModule = GameModule<any, any, any>;
