import { nextRandom } from "../../engine/rng";
import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";
import { redactHands } from "../shared/hiddenHand";

/**
 * Dominoes with a double-six set.
 *
 * Tiles in hand are hidden information — the fact that the layout sits on a
 * "table" doesn't change that — so this reuses the same redaction helper as
 * Whot and Crazy 8s rather than the public-view path.
 */

export interface Tile {
  /** Stable id so clients can key and animate tiles. */
  id: string;
  a: number;
  b: number;
}

export type DominoesEnd = "left" | "right";

export type DominoesMove =
  | { type: "play"; tileId: string; end: DominoesEnd }
  | { type: "draw" }
  | { type: "pass" };

export interface DominoesRules {
  id: string;
  name: string;
  description: string;
  /** Draw variant: take from the boneyard when you cannot play. */
  allowDraw: boolean;
  /** Tiles dealt to each player. */
  handSize: number;
  /** The highest double must open the game; otherwise the first seat opens. */
  highestDoubleStarts: boolean;
}

export const BLOCK_DOMINOES: DominoesRules = {
  id: "block",
  name: "Block",
  description: "No boneyard draws — if you cannot play, you pass. Blocks are common.",
  allowDraw: false,
  handSize: 7,
  highestDoubleStarts: true,
};

export const DRAW_DOMINOES: DominoesRules = {
  id: "draw",
  name: "Draw",
  description: "Cannot play? Draw from the boneyard until you can, or until it is empty.",
  allowDraw: true,
  handSize: 7,
  highestDoubleStarts: true,
};

export const DOMINOES_VARIANTS: DominoesRules[] = [BLOCK_DOMINOES, DRAW_DOMINOES];

export function getDominoesVariant(id: string | undefined): DominoesRules {
  return DOMINOES_VARIANTS.find((v) => v.id === id) ?? BLOCK_DOMINOES;
}

export interface DominoesPlayerState {
  id: string;
  hand: Tile[];
  /** Consecutive passes, used to detect a blocked game. */
  passed: boolean;
}

/** A tile as laid down, with the pips oriented along the chain. */
export interface PlacedTile {
  id: string;
  /** Pip facing the left end of the chain. */
  left: number;
  /** Pip facing the right end of the chain. */
  right: number;
  isDouble: boolean;
}

export interface DominoesState {
  rules: DominoesRules;
  players: DominoesPlayerState[];
  /** The layout, left end first. */
  layout: PlacedTile[];
  boneyard: Tile[];
  currentIndex: number;
  rngState: number;
  finished: boolean;
  winners: string[];
  /** How the game ended, for the result banner. */
  endReason: "emptyHand" | "blocked" | null;
  /** Pip totals at the end, for a blocked finish. */
  finalPips: Record<string, number> | null;
}

export interface DominoesPlayerView {
  rulesId: string;
  rulesName: string;
  /** Only ever this recipient's own tiles. */
  myHand: Tile[];
  /** Tile counts only — never the tiles. */
  opponents: Array<{ id: string; tileCount: number }>;
  layout: PlacedTile[];
  /** The two open ends the next tile must match. */
  openEnds: { left: number | null; right: number | null };
  boneyardCount: number;
  currentPlayerId: string | null;
  /** Tile ids in `myHand` that are playable, with which ends they fit. */
  playable: Array<{ tileId: string; ends: DominoesEnd[] }>;
  canDraw: boolean;
  mustPass: boolean;
  finished: boolean;
  winners: string[];
  endReason: DominoesState["endReason"];
  finalPips: Record<string, number> | null;
  seesAllHands: boolean;
  allHands: Record<string, Tile[]>;
}

/** The 28 tiles of a double-six set. */
export function buildSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) tiles.push({ id: `${a}-${b}`, a, b });
  }
  return tiles;
}

function shuffle(tiles: Tile[], rngState: number): { tiles: Tile[]; rngState: number } {
  const out = [...tiles];
  let state = rngState;
  for (let i = out.length - 1; i > 0; i--) {
    const next = nextRandom(state);
    state = next.state;
    const j = Math.floor(next.value * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return { tiles: out, rngState: state };
}

export const pipTotal = (hand: Tile[]): number => hand.reduce((sum, t) => sum + t.a + t.b, 0);

/** Open ends of the layout; both null before the first tile. */
export function openEnds(state: DominoesState): { left: number | null; right: number | null } {
  if (state.layout.length === 0) return { left: null, right: null };
  return {
    left: state.layout[0]!.left,
    right: state.layout[state.layout.length - 1]!.right,
  };
}

const playerOf = (state: DominoesState, id: string) => state.players.find((p) => p.id === id) ?? null;

/** Which ends a tile can legally attach to. */
export function fittingEnds(state: DominoesState, tile: Tile): DominoesEnd[] {
  const { left, right } = openEnds(state);
  if (left === null || right === null) return ["right"]; // opening move
  const ends: DominoesEnd[] = [];
  if (tile.a === left || tile.b === left) ends.push("left");
  if (tile.a === right || tile.b === right) ends.push("right");
  return ends;
}

/** Everything the given player could put down right now. */
export function playableTiles(
  state: DominoesState,
  playerId: string
): Array<{ tileId: string; ends: DominoesEnd[] }> {
  const player = playerOf(state, playerId);
  if (!player) return [];
  return player.hand
    .map((tile) => ({ tileId: tile.id, ends: fittingEnds(state, tile) }))
    .filter((entry) => entry.ends.length > 0);
}

/** Orients a tile so the matching pip faces the chain. */
function orient(tile: Tile, end: DominoesEnd, state: DominoesState): PlacedTile {
  const ends = openEnds(state);
  const isDouble = tile.a === tile.b;

  if (ends.left === null || ends.right === null) {
    return { id: tile.id, left: tile.a, right: tile.b, isDouble };
  }
  if (end === "left") {
    // The pip touching the layout must equal the current left end.
    const touching = tile.b === ends.left ? tile.b : tile.a;
    const outer = touching === tile.a ? tile.b : tile.a;
    return { id: tile.id, left: outer, right: touching, isDouble };
  }
  const touching = tile.a === ends.right ? tile.a : tile.b;
  const outer = touching === tile.a ? tile.b : tile.a;
  return { id: tile.id, left: touching, right: outer, isDouble };
}

function advance(state: DominoesState): void {
  state.currentIndex = (state.currentIndex + 1) % state.players.length;
}

/** Ends the game on pip count when nobody can move. */
function settleBlocked(state: DominoesState, events: GameEvent[]): void {
  const totals = state.players.map((p) => ({ id: p.id, pips: pipTotal(p.hand) }));
  const lowest = Math.min(...totals.map((t) => t.pips));
  state.finished = true;
  state.endReason = "blocked";
  state.winners = totals.filter((t) => t.pips === lowest).map((t) => t.id);
  state.finalPips = Object.fromEntries(totals.map((t) => [t.id, t.pips]));
  events.push({
    type: "blocked",
    text: `game blocked — lowest pip count wins (${lowest})`,
    data: { totals: state.finalPips },
  });
}

const isType = (move: unknown, type: string): boolean =>
  typeof move === "object" && move !== null && (move as { type?: unknown }).type === type;

function isPlayMove(move: unknown): move is { type: "play"; tileId: string; end: DominoesEnd } {
  if (!isType(move, "play")) return false;
  const m = move as { tileId?: unknown; end?: unknown };
  return typeof m.tileId === "string" && (m.end === "left" || m.end === "right");
}

export const dominoesModule: GameModule<DominoesState, DominoesMove, DominoesPlayerView> = {
  meta: {
    id: "dominoes",
    name: "Dominoes",
    tagline: "Match the ends, block your neighbour, and count the pips when it jams.",
    minPlayers: 2,
    maxPlayers: 4,
    category: "board",
    modes: ["room"],
    hasHiddenState: true,
    estimatedMinutes: 12,
    variants: DOMINOES_VARIANTS.map((v) => ({ id: v.id, name: v.name, description: v.description })),
    variantOptionKey: "variant",
  },

  createInitialState(players: string[], options: GameOptions = {}): DominoesState {
    const rules = getDominoesVariant(options.variant as string | undefined);
    const seed = typeof options.seed === "number" ? options.seed : Math.floor(Math.random() * 2 ** 31);
    const shuffled = shuffle(buildSet(), seed >>> 0);
    const pool = shuffled.tiles;

    const hands: DominoesPlayerState[] = players.map((id) => ({ id, hand: [], passed: false }));
    for (let i = 0; i < rules.handSize; i++) {
      for (const player of hands) {
        const tile = pool.pop();
        if (tile) player.hand.push(tile);
      }
    }

    // Whoever holds the highest double opens, which is the usual convention.
    let opener = 0;
    if (rules.highestDoubleStarts) {
      let best = -1;
      hands.forEach((player, index) => {
        for (const tile of player.hand) {
          if (tile.a === tile.b && tile.a > best) {
            best = tile.a;
            opener = index;
          }
        }
      });
    }

    return {
      rules,
      players: hands,
      layout: [],
      boneyard: pool,
      currentIndex: opener,
      rngState: shuffled.rngState,
      finished: false,
      winners: [],
      endReason: null,
      finalPips: null,
    };
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished) return false;
    if (state.players[state.currentIndex]?.id !== playerId) return false;
    const player = playerOf(state, playerId);
    if (!player) return false;

    if (isType(move, "draw")) {
      if (!state.rules.allowDraw) return false;
      if (state.boneyard.length === 0) return false;
      // Drawing is for when you are stuck, not a free extra tile.
      return playableTiles(state, playerId).length === 0;
    }

    if (isType(move, "pass")) {
      if (playableTiles(state, playerId).length > 0) return false;
      // In the draw variant you must exhaust the boneyard before passing.
      if (state.rules.allowDraw && state.boneyard.length > 0) return false;
      return true;
    }

    if (!isPlayMove(move)) return false;
    const tile = player.hand.find((t) => t.id === move.tileId);
    if (!tile) return false;
    return fittingEnds(state, tile).includes(move.end);
  },

  applyMove(state, playerId, move): ApplyResult<DominoesState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const next: DominoesState = structuredClone(state);
    const events: GameEvent[] = [];
    const player = playerOf(next, playerId)!;

    if (isType(move, "draw")) {
      const tile = next.boneyard.pop()!;
      player.hand.push(tile);
      player.passed = false;
      events.push({ type: "draw", playerId, text: "draws from the boneyard" });
      // Still their turn: they may now be able to play.
      return { state: next, events };
    }

    if (isType(move, "pass")) {
      player.passed = true;
      events.push({ type: "pass", playerId, text: "cannot play — passes" });
      // Everyone stuck in a row means the game is jammed.
      if (next.players.every((p) => p.passed)) {
        settleBlocked(next, events);
        return { state: next, events };
      }
      advance(next);
      return { state: next, events };
    }

    // ---- play a tile ----
    const { tileId, end } = move as { tileId: string; end: DominoesEnd };
    const index = player.hand.findIndex((t) => t.id === tileId);
    const tile = player.hand[index]!;
    const placed = orient(tile, end, next);
    player.hand.splice(index, 1);

    if (end === "left") next.layout.unshift(placed);
    else next.layout.push(placed);

    // A tile going down unblocks the table.
    for (const p of next.players) p.passed = false;

    events.push({
      type: "play",
      playerId,
      text: `plays ${tile.a}–${tile.b}`,
      data: { tile, end },
    });

    if (player.hand.length === 0) {
      next.finished = true;
      next.endReason = "emptyHand";
      next.winners = [playerId];
      next.finalPips = Object.fromEntries(next.players.map((p) => [p.id, pipTotal(p.hand)]));
      events.push({ type: "gameOver", playerId, text: "lays their last tile and wins!" });
      return { state: next, events };
    }

    advance(next);

    // If nobody can move and there is nothing to draw, the game is blocked.
    const anyoneCanAct = next.players.some(
      (p) => playableTiles(next, p.id).length > 0 || (next.rules.allowDraw && next.boneyard.length > 0)
    );
    if (!anyoneCanAct) settleBlocked(next, events);

    return { state: next, events };
  },

  /** Hidden hands, via the same helper Whot and Crazy 8s use. */
  getPlayerView(state, playerId): DominoesPlayerView {
    const hidden = redactHands<Tile, DominoesPlayerState>(state.players, {
      viewerId: playerId,
      revealAll: state.finished,
    });
    const isMyTurn = !state.finished && state.players[state.currentIndex]?.id === playerId;
    const playable = isMyTurn && playerId ? playableTiles(state, playerId) : [];

    return {
      rulesId: state.rules.id,
      rulesName: state.rules.name,
      myHand: hidden.myHand,
      opponents: state.players
        .filter((p) => p.id !== playerId)
        .map((p) => ({ id: p.id, tileCount: p.hand.length })),
      layout: state.layout,
      openEnds: openEnds(state),
      boneyardCount: state.boneyard.length,
      currentPlayerId: state.finished ? null : state.players[state.currentIndex]?.id ?? null,
      playable,
      canDraw: isMyTurn && state.rules.allowDraw && state.boneyard.length > 0 && playable.length === 0,
      mustPass:
        isMyTurn &&
        playable.length === 0 &&
        (!state.rules.allowDraw || state.boneyard.length === 0),
      finished: state.finished,
      winners: state.winners,
      endReason: state.endReason,
      finalPips: state.finalPips,
      seesAllHands: hidden.seesAllHands,
      allHands: hidden.allHands,
    };
  },

  checkWinCondition(state): WinCondition | null {
    if (!state.finished) return null;
    return { finished: true, winners: state.winners };
  },

  getCurrentPlayerId(state): string | null {
    if (state.finished) return null;
    return state.players[state.currentIndex]?.id ?? null;
  },

  getTimeoutMove(state, playerId): DominoesMove | null {
    if (state.finished || state.players[state.currentIndex]?.id !== playerId) return null;
    const options = playableTiles(state, playerId);
    const first = options[0];
    if (first) return { type: "play", tileId: first.tileId, end: first.ends[0]! };
    if (state.rules.allowDraw && state.boneyard.length > 0) return { type: "draw" };
    return { type: "pass" };
  },

  getEliminatedPlayers(): string[] {
    return [];
  },
};
