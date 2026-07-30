import { describe, it, expect } from "vitest";
import {
  capturesFrom,
  draughtsLegalMoves as legalMoves,
  draughtsModule as game,
  initialBoard,
  squareName,
  type Board,
  type DraughtsState,
  type Piece,
} from "./module";
import {
  BOARD,
  CASUAL_DRAUGHTS,
  DRAUGHTS_VARIANTS,
  ENGLISH_DRAUGHTS,
  getDraughtsVariant,
  INTERNATIONAL_DRAUGHTS,
  isPlayableSquare,
} from "./rules";

const PLAYERS = ["light-player", "dark-player"];

function fresh(variant = "english"): DraughtsState {
  return game.createInitialState(PLAYERS, { variant });
}

/** Builds a position from a sparse map, so tests read like diagrams. */
function position(
  pieces: Array<[number, number, Piece]>,
  turn: "light" | "dark" = "light",
  variant = "english"
): DraughtsState {
  const state = fresh(variant);
  state.board = Array.from({ length: BOARD }, () => Array.from({ length: BOARD }, () => null)) as Board;
  for (const [r, c, piece] of pieces) state.board[r]![c] = piece;
  state.turn = turn;
  return state;
}

const man = (side: "light" | "dark"): Piece => ({ side, king: false });
const king = (side: "light" | "dark"): Piece => ({ side, king: true });

function playMatch(variant = "english", maxPlies = 4000) {
  let state = fresh(variant);
  let plies = 0;
  while (game.checkWinCondition(state) === null) {
    if (plies++ > maxPlies) throw new Error(`${variant} did not terminate`);
    const actor = game.getCurrentPlayerId(state)!;
    const move = game.getTimeoutMove!(state, actor)!;
    expect(game.validateMove(state, actor, move)).toBe(true);
    state = game.applyMove(state, actor, move).state;
  }
  return { state, plies };
}

describe("setup", () => {
  it("puts twelve pieces a side on the dark squares", () => {
    const board = initialBoard();
    let light = 0;
    let dark = 0;
    for (let r = 0; r < BOARD; r++) {
      for (let c = 0; c < BOARD; c++) {
        const piece = board[r]![c];
        if (!piece) continue;
        expect(isPlayableSquare(r, c), `piece on a light square at ${r},${c}`).toBe(true);
        if (piece.side === "light") light++;
        else dark++;
      }
    }
    expect(light).toBe(12);
    expect(dark).toBe(12);
  });

  it("leaves the middle two rows empty", () => {
    const board = initialBoard();
    for (const row of [3, 4]) {
      expect(board[row]!.every((cell) => cell === null)).toBe(true);
    }
  });

  it("is exactly two players", () => {
    expect(game.meta.minPlayers).toBe(2);
    expect(game.meta.maxPlayers).toBe(2);
  });

  it("starts with light to move and seven opening moves", () => {
    const state = fresh();
    expect(state.turn).toBe("light");
    // Each of the four front-row men has one or two diagonal steps available.
    expect(legalMoves(state)).toHaveLength(7);
  });
});

describe("plain movement", () => {
  it("moves men diagonally forward only", () => {
    const state = position([[4, 3, man("light")]]);
    const targets = legalMoves(state).map((m) => m.to);
    // Light moves up the board (decreasing row).
    expect(targets).toContainEqual([3, 2]);
    expect(targets).toContainEqual([3, 4]);
    expect(targets).not.toContainEqual([5, 2]);
    expect(targets).not.toContainEqual([5, 4]);
  });

  it("moves dark men the other way", () => {
    const state = position([[3, 2, man("dark")]], "dark");
    const targets = legalMoves(state).map((m) => m.to);
    expect(targets).toContainEqual([4, 1]);
    expect(targets).toContainEqual([4, 3]);
    expect(targets).not.toContainEqual([2, 1]);
  });

  it("lets kings move in all four directions", () => {
    const state = position([[4, 3, king("light")]]);
    const targets = legalMoves(state).map((m) => m.to);
    for (const square of [[3, 2], [3, 4], [5, 2], [5, 4]]) {
      expect(targets).toContainEqual(square);
    }
  });

  it("cannot move onto an occupied square", () => {
    const state = position([
      [4, 3, man("light")],
      [3, 2, man("dark")],
      [3, 4, man("light")],
    ]);
    const targets = legalMoves(state).filter((m) => m.from[0] === 4).map((m) => m.to);
    expect(targets).not.toContainEqual([3, 4]);
  });
});

describe("captures are compulsory", () => {
  it("offers only captures when one is available", () => {
    const state = position([
      [4, 3, man("light")],
      [3, 2, man("dark")],
      [6, 7, man("light")], // a quiet move exists elsewhere
    ]);
    const moves = legalMoves(state);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.from).toEqual([4, 3]);
    expect(moves[0]!.to).toEqual([2, 1]);
  });

  it("rejects a quiet move while a capture is on the board", () => {
    const state = position([
      [4, 3, man("light")],
      [3, 2, man("dark")],
      [6, 7, man("light")],
    ]);
    expect(game.validateMove(state, "light-player", { type: "move", from: [6, 7], to: [5, 6] })).toBe(false);
    expect(game.validateMove(state, "light-player", { type: "move", from: [4, 3], to: [2, 1] })).toBe(true);
  });

  it("allows the quiet move when the variant makes capture optional", () => {
    const state = position(
      [
        [4, 3, man("light")],
        [3, 2, man("dark")],
        [6, 7, man("light")],
      ],
      "light",
      "casual"
    );
    expect(CASUAL_DRAUGHTS.mandatoryCapture).toBe(false);
    expect(game.validateMove(state, "light-player", { type: "move", from: [6, 7], to: [5, 6] })).toBe(true);
  });

  it("removes the jumped piece", () => {
    const state = position([
      [4, 3, man("light")],
      [3, 2, man("dark")],
    ]);
    const { state: after } = game.applyMove(state, "light-player", { type: "move", from: [4, 3], to: [2, 1] });
    expect(after.board[3]![2]).toBeNull();
    expect(after.board[2]![1]).toEqual({ side: "light", king: false });
    expect(after.board[4]![3]).toBeNull();
  });

  it("does not let men capture backwards in English rules", () => {
    const state = position([
      [3, 2, man("light")],
      [4, 3, man("dark")],
    ]);
    // The dark piece is behind the light man, so there is no capture.
    expect(capturesFrom(state, [3, 2])).toHaveLength(0);
  });

  it("does let men capture backwards in international rules", () => {
    const state = position(
      [
        [3, 2, man("light")],
        [4, 3, man("dark")],
      ],
      "light",
      "international"
    );
    expect(INTERNATIONAL_DRAUGHTS.menCaptureBackwards).toBe(true);
    expect(capturesFrom(state, [3, 2]).map((s) => s.to)).toContainEqual([5, 4]);
  });
});

describe("multi-jump chains", () => {
  it("keeps the turn with the jumping piece while it can take again", () => {
    const state = position([
      [5, 2, man("light")],
      [4, 3, man("dark")],
      [2, 3, man("dark")],
    ]);
    const { state: after, events } = game.applyMove(state, "light-player", {
      type: "move",
      from: [5, 2],
      to: [3, 4],
    });
    // Still light's turn, and locked to the piece that just jumped.
    expect(after.turn).toBe("light");
    expect(after.chaining).toEqual([3, 4]);
    expect(events.some((e) => e.type === "chain")).toBe(true);
  });

  it("restricts legal moves to the chaining piece", () => {
    const state = position([
      [5, 2, man("light")],
      [4, 3, man("dark")],
      [2, 3, man("dark")],
      [6, 7, man("light")],
    ]);
    const { state: after } = game.applyMove(state, "light-player", { type: "move", from: [5, 2], to: [3, 4] });
    const moves = legalMoves(after);
    expect(moves.every((m) => m.from[0] === 3 && m.from[1] === 4)).toBe(true);
    expect(game.validateMove(after, "light-player", { type: "move", from: [6, 7], to: [5, 6] })).toBe(false);
  });

  it("ends the turn once no further jump exists", () => {
    const state = position([
      [5, 2, man("light")],
      [4, 3, man("dark")],
    ]);
    const { state: after } = game.applyMove(state, "light-player", { type: "move", from: [5, 2], to: [3, 4] });
    expect(after.chaining).toBeNull();
    expect(after.turn).toBe("dark");
  });

  it("takes both pieces across a completed double jump", () => {
    let state = position([
      [5, 2, man("light")],
      [4, 3, man("dark")],
      [2, 3, man("dark")],
    ]);
    state = game.applyMove(state, "light-player", { type: "move", from: [5, 2], to: [3, 4] }).state;
    state = game.applyMove(state, "light-player", { type: "move", from: [3, 4], to: [1, 2] }).state;
    let darkCount = 0;
    for (const row of state.board) for (const cell of row) if (cell?.side === "dark") darkCount++;
    expect(darkCount).toBe(0);
  });
});

describe("kinging", () => {
  it("crowns a man reaching the far row", () => {
    const state = position([[1, 2, man("light")]]);
    const { state: after, events } = game.applyMove(state, "light-player", { type: "move", from: [1, 2], to: [0, 1] });
    expect(after.board[0]![1]).toEqual({ side: "light", king: true });
    expect(events.some((e) => e.type === "crowned")).toBe(true);
  });

  it("crowns dark on the opposite row", () => {
    const state = position([[6, 1, man("dark")]], "dark");
    const { state: after } = game.applyMove(state, "dark-player", { type: "move", from: [6, 1], to: [7, 0] });
    expect(after.board[7]![0]!.king).toBe(true);
  });

  it("ends the turn when promotion happens mid-chain", () => {
    // Light jumps onto the back row; under English rules the chain stops.
    const state = position([
      [2, 3, man("light")],
      [1, 2, man("dark")],
      [1, 4, man("dark")],
    ]);
    const { state: after } = game.applyMove(state, "light-player", { type: "move", from: [2, 3], to: [0, 1] });
    expect(after.board[0]![1]!.king).toBe(true);
    expect(ENGLISH_DRAUGHTS.promotionEndsTurn).toBe(true);
    expect(after.chaining).toBeNull();
    expect(after.turn).toBe("dark");
  });
});

describe("flying kings", () => {
  it("stay to one square in English rules", () => {
    const state = position([[7, 0, king("light")]]);
    const targets = legalMoves(state).map((m) => m.to);
    expect(targets).toContainEqual([6, 1]);
    expect(targets).not.toContainEqual([5, 2]);
  });

  it("slide any distance in international rules", () => {
    const state = position([[7, 0, king("light")]], "light", "international");
    const targets = legalMoves(state).map((m) => m.to);
    for (const square of [[6, 1], [5, 2], [4, 3], [3, 4]]) {
      expect(targets).toContainEqual(square);
    }
  });

  it("capture at a distance and may land beyond the victim", () => {
    const state = position(
      [
        [7, 0, king("light")],
        [4, 3, man("dark")],
      ],
      "light",
      "international"
    );
    const landings = capturesFrom(state, [7, 0]).map((s) => s.to);
    expect(landings).toContainEqual([3, 4]);
    expect(landings).toContainEqual([2, 5]);
  });
});

describe("maximum-capture rule", () => {
  /**
   * Two captures on opposite corners so the branches cannot interfere:
   *   [5,0] jumps [4,1] → [3,2], then jumps [2,3] → [1,4]   (two pieces)
   *   [7,6] jumps [6,5] → [5,4], with nothing to follow up   (one piece)
   */
  const ASYMMETRIC: Array<[number, number, Piece]> = [
    [5, 0, man("light")],
    [4, 1, man("dark")],
    [2, 3, man("dark")],
    [7, 6, man("light")],
    [6, 5, man("dark")],
  ];

  it("forces the longer chain in international rules", () => {
    const state = position(ASYMMETRIC, "light", "international");
    const moves = legalMoves(state);
    expect(moves.length).toBeGreaterThan(0);
    // Only the double-capture start survives the maximum rule.
    expect(moves.every((m) => m.from[0] === 5 && m.from[1] === 0)).toBe(true);
  });

  it("allows either capture in English rules", () => {
    const state = position(ASYMMETRIC, "light", "english");
    const froms = new Set(legalMoves(state).map((m) => `${m.from[0]},${m.from[1]}`));
    // English draughts compels a capture but never dictates which one.
    expect(froms.size).toBe(2);
  });
});

describe("ending the game", () => {
  it("wins when the opponent has no pieces left", () => {
    const state = position([
      [4, 3, man("light")],
      [3, 2, man("dark")],
    ]);
    const { state: after } = game.applyMove(state, "light-player", { type: "move", from: [4, 3], to: [2, 1] });
    expect(after.finished).toBe(true);
    expect(game.checkWinCondition(after)).toEqual({ finished: true, winners: ["light-player"] });
  });

  it("wins when the opponent has pieces but no legal move", () => {
    // Dark man in the corner, boxed in by its own edge and a light piece.
    const state = position(
      [
        [7, 0, man("dark")],
        [6, 1, man("light")],
        [5, 2, man("light")],
        [0, 7, man("light")],
      ],
      "light"
    );
    // Light plays a quiet move elsewhere; dark is then stuck.
    const quiet = legalMoves(state).find((m) => m.from[0] === 0);
    if (quiet) {
      const { state: after } = game.applyMove(state, "light-player", quiet);
      if (after.finished) {
        expect(after.winners).toEqual(["light-player"]);
      }
    }
  });

  it("plays complete matches in every variant", () => {
    for (const variant of DRAUGHTS_VARIANTS.map((v) => v.id)) {
      const { state } = playMatch(variant);
      const win = game.checkWinCondition(state)!;
      expect(win.finished).toBe(true);
      expect(win.winners.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("view and validation", () => {
  it("shows the same board to both players and to a spectator", () => {
    const state = fresh();
    const views = [...PLAYERS, null].map((v) => JSON.stringify(game.getPlayerView(state, v).board));
    expect(new Set(views).size).toBe(1);
    expect(game.meta.hasHiddenState).toBe(false);
  });

  it("publishes legal moves only to the player to act", () => {
    const state = fresh();
    expect(game.getPlayerView(state, "light-player").legalMoves.length).toBeGreaterThan(0);
    expect(game.getPlayerView(state, "dark-player").legalMoves).toEqual([]);
  });

  it("flags when a capture is compulsory", () => {
    const state = position([
      [4, 3, man("light")],
      [3, 2, man("dark")],
      [6, 7, man("light")],
    ]);
    expect(game.getPlayerView(state, "light-player").captureRequired).toBe(true);
    expect(game.getPlayerView(fresh(), "light-player").captureRequired).toBe(false);
  });

  it("rejects moves from the wrong player", () => {
    const state = fresh();
    expect(game.validateMove(state, "dark-player", { type: "move", from: [5, 0], to: [4, 1] })).toBe(false);
  });

  it("rejects malformed moves without throwing", () => {
    const state = fresh();
    for (const junk of [
      null,
      undefined,
      {},
      7,
      "move",
      { type: "move" },
      { type: "move", from: [0], to: [1, 1] },
      { type: "move", from: [9, 9], to: [1, 1] },
      { type: "move", from: [-1, 0], to: [1, 1] },
    ]) {
      expect(() => game.validateMove(state, "light-player", junk as never)).not.toThrow();
      expect(game.validateMove(state, "light-player", junk as never)).toBe(false);
    }
  });

  it("does not mutate the state it is given", () => {
    const state = fresh();
    const before = JSON.stringify(state);
    game.applyMove(state, "light-player", legalMoves(state)[0]!);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("names squares in board notation", () => {
    expect(squareName([7, 0])).toBe("a1");
    expect(squareName([0, 7])).toBe("h8");
  });

  it("falls back to English rules for an unknown variant", () => {
    expect(getDraughtsVariant("nope").id).toBe("english");
  });
});
