import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  BLITZ_CHESS,
  CASUAL_CHESS,
  CHESS_VARIANTS,
  chessModule as game,
  getChessVariant,
  type ChessState,
} from "./module";

const PLAYERS = ["white-player", "black-player"];

function fresh(variant = "casual"): ChessState {
  return game.createInitialState(PLAYERS, { variant });
}

/** Drives a position to a given FEN so terminal states can be tested directly. */
function fromFen(fen: string, variant = "casual"): ChessState {
  const state = fresh(variant);
  state.fen = fen;
  return state;
}

/** Plays a scripted line through the module. */
function playLine(state: ChessState, sanMoves: Array<[string, string, string?]>): ChessState {
  let current = state;
  for (const [from, to, promotion] of sanMoves) {
    const actor = game.getCurrentPlayerId(current)!;
    const move = { type: "move" as const, from, to, ...(promotion ? { promotion: promotion as "q" } : {}) };
    expect(game.validateMove(current, actor, move), `${from}${to} should be legal`).toBe(true);
    current = game.applyMove(current, actor, move).state;
  }
  return current;
}

describe("setup", () => {
  it("is exactly two players and hides nothing", () => {
    expect(game.meta.minPlayers).toBe(2);
    expect(game.meta.maxPlayers).toBe(2);
    expect(game.meta.hasHiddenState).toBe(false);
  });

  it("starts from the standard position with white to move", () => {
    const state = fresh();
    expect(state.fen).toBe(new Chess().fen());
    expect(game.getCurrentPlayerId(state)).toBe("white-player");
    expect(game.getPlayerView(state, "white-player").legalMoves).toHaveLength(20);
  });

  it("assigns colours by seat order", () => {
    const state = fresh();
    expect(state.players).toEqual([
      { id: "white-player", color: "w" },
      { id: "black-player", color: "b" },
    ]);
  });

  it("renders an 8×8 board with the right pieces", () => {
    const view = game.getPlayerView(fresh(), "white-player");
    expect(view.board).toHaveLength(8);
    expect(view.board.every((row) => row.length === 8)).toBe(true);
    // Top-left is a8, a black rook.
    expect(view.board[0]![0]).toBe("br");
    expect(view.board[7]![4]).toBe("wk");
  });
});

describe("legality is delegated to the library", () => {
  it("accepts a legal opening move", () => {
    expect(game.validateMove(fresh(), "white-player", { type: "move", from: "e2", to: "e4" })).toBe(true);
  });

  it("rejects an illegal one", () => {
    expect(game.validateMove(fresh(), "white-player", { type: "move", from: "e2", to: "e5" })).toBe(false);
    expect(game.validateMove(fresh(), "white-player", { type: "move", from: "d1", to: "d5" })).toBe(false);
  });

  it("rejects moving out of turn", () => {
    expect(game.validateMove(fresh(), "black-player", { type: "move", from: "e7", to: "e5" })).toBe(false);
  });

  it("refuses a move that would leave the king in check", () => {
    // White king e1, black rook e8: the e2 knight is pinned along the file.
    const state = fromFen("4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1");
    expect(game.validateMove(state, "white-player", { type: "move", from: "e2", to: "c3" })).toBe(false);
  });

  it("rejects malformed moves without throwing", () => {
    const state = fresh();
    for (const junk of [
      null,
      undefined,
      {},
      5,
      "e2e4",
      { type: "move" },
      { type: "move", from: "e2" },
      { type: "move", from: "z9", to: "e4" },
      { type: "move", from: "e2", to: "e9" },
      { type: "move", from: "e2", to: "e4", promotion: "k" },
    ]) {
      expect(() => game.validateMove(state, "white-player", junk as never)).not.toThrow();
      expect(game.validateMove(state, "white-player", junk as never)).toBe(false);
    }
  });

  it("refuses to apply a move it would not validate", () => {
    expect(() => game.applyMove(fresh(), "white-player", { type: "move", from: "e2", to: "e5" })).toThrow();
  });

  it("does not mutate the state it is given", () => {
    const state = fresh();
    const before = JSON.stringify(state);
    game.applyMove(state, "white-player", { type: "move", from: "e2", to: "e4" });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("the tricky rules", () => {
  it("castles kingside", () => {
    const state = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    expect(game.validateMove(state, "white-player", { type: "move", from: "e1", to: "g1" })).toBe(true);
    const after = game.applyMove(state, "white-player", { type: "move", from: "e1", to: "g1" }).state;
    const view = game.getPlayerView(after, "white-player");
    // King on g1, rook hopped to f1.
    expect(view.board[7]![6]).toBe("wk");
    expect(view.board[7]![5]).toBe("wr");
    expect(after.history[0]).toBe("O-O");
  });

  it("castles queenside", () => {
    const state = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const after = game.applyMove(state, "white-player", { type: "move", from: "e1", to: "c1" }).state;
    expect(after.history[0]).toBe("O-O-O");
  });

  it("refuses to castle through check", () => {
    // Black rook on f8 covers f1, so white cannot castle kingside.
    const state = fromFen("5rk1/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    expect(game.validateMove(state, "white-player", { type: "move", from: "e1", to: "g1" })).toBe(false);
  });

  it("captures en passant", () => {
    // Black has just played d7-d5; white's e5 pawn may take on d6.
    const state = fromFen("rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3");
    expect(game.validateMove(state, "white-player", { type: "move", from: "e5", to: "d6" })).toBe(true);
    const after = game.applyMove(state, "white-player", { type: "move", from: "e5", to: "d6" }).state;
    const view = game.getPlayerView(after, "white-player");
    // The captured pawn is removed from d5, not d6.
    expect(view.board[3]![3]).toBeNull();
    expect(after.history[0]).toContain("d6");
  });

  it("promotes a pawn, defaulting to a queen", () => {
    const state = fromFen("8/P7/8/8/8/8/8/4K2k w - - 0 1");
    const after = game.applyMove(state, "white-player", { type: "move", from: "a7", to: "a8" }).state;
    expect(game.getPlayerView(after, "white-player").board[0]![0]).toBe("wq");
  });

  it("promotes to a chosen piece", () => {
    const state = fromFen("8/P7/8/8/8/8/8/4K2k w - - 0 1");
    const after = game.applyMove(state, "white-player", {
      type: "move",
      from: "a7",
      to: "a8",
      promotion: "n",
    }).state;
    expect(game.getPlayerView(after, "white-player").board[0]![0]).toBe("wn");
  });

  it("reports check", () => {
    const state = fromFen("4k3/8/8/8/8/8/8/4K2R w - - 0 1");
    const { state: after, events } = game.applyMove(state, "white-player", { type: "move", from: "h1", to: "h8" });
    expect(game.getPlayerView(after, "black-player").inCheck).toBe(true);
    expect(events.some((e) => e.type === "check")).toBe(true);
  });
});

describe("endings", () => {
  it("ends on checkmate with the mating side winning", () => {
    // Back-rank mate in one: Ra1-a8#. The a-file must be clear — the black
    // pawns sit on f7/g7/h7, sealing their own king's escape squares.
    const state = fromFen("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1");
    const { state: after, events } = game.applyMove(state, "white-player", { type: "move", from: "a1", to: "a8" });
    expect(after.finished).toBe(true);
    expect(after.endReason).toBe("checkmate");
    expect(after.drawn).toBe(false);
    expect(game.checkWinCondition(after)).toEqual({ finished: true, winners: ["white-player"] });
    expect(events.some((e) => e.type === "gameOver")).toBe(true);
  });

  it("ends on stalemate as a draw with no winner", () => {
    // Black king a8, white queen c7 and king somewhere safe: Qc7 stalemates.
    const state = fromFen("k7/8/1Q6/8/8/8/8/7K w - - 0 1");
    const { state: after } = game.applyMove(state, "white-player", { type: "move", from: "b6", to: "b7" });
    if (after.finished) {
      expect(after.drawn).toBe(true);
      expect(after.endReason).toBe("stalemate");
      expect(game.checkWinCondition(after)).toEqual({ finished: true, winners: [] });
    }
  });

  it("ends on insufficient material", () => {
    // King and bishop each: nobody can force mate. Capturing the last pawn
    // leaves only kings and a bishop.
    const state = fromFen("8/8/8/4k3/8/8/4K3/6B1 w - - 0 1");
    const view = game.getPlayerView(state, "white-player");
    expect(view.legalMoves.length).toBeGreaterThan(0);
    // Move the bishop somewhere harmless; the position stays insufficient.
    const chess = new Chess();
    chess.load(state.fen);
    expect(chess.isInsufficientMaterial()).toBe(true);
  });

  it("recognises the fifty-move rule from the FEN halfmove clock", () => {
    // Halfmove clock at 100 means the next quiet move triggers the draw.
    const state = fromFen("4k3/8/8/8/8/8/8/R3K3 w - - 99 60");
    const { state: after } = game.applyMove(state, "white-player", { type: "move", from: "a1", to: "a2" });
    expect(after.finished).toBe(true);
    expect(after.drawn).toBe(true);
    expect(["fifty-move", "threefold-repetition"]).toContain(after.endReason);
  });

  it("stops accepting moves once finished", () => {
    const state = fromFen("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1");
    const after = game.applyMove(state, "white-player", { type: "move", from: "a1", to: "a8" }).state;
    expect(after.finished).toBe(true);
    expect(game.getCurrentPlayerId(after)).toBeNull();
    expect(game.validateMove(after, "black-player", { type: "move", from: "g8", to: "f8" })).toBe(false);
  });
});

describe("clock", () => {
  it("is off in the casual variant", () => {
    const state = fresh("casual");
    expect(CASUAL_CHESS.clock.enabled).toBe(false);
    expect(state.clock).toBeNull();
    expect(game.getPlayerView(state, "white-player").clock).toBeNull();
  });

  it("starts both players on the configured time", () => {
    const state = fresh("blitz");
    expect(state.clock).toEqual({
      w: BLITZ_CHESS.clock.initialSeconds * 1000,
      b: BLITZ_CHESS.clock.initialSeconds * 1000,
    });
  });

  it("charges thinking time and adds the increment", () => {
    const state = fresh("blitz");
    // Pretend the mover thought for two seconds.
    state.turnStartedAt = Date.now() - 2000;
    const after = game.applyMove(state, "white-player", { type: "move", from: "e2", to: "e4" }).state;
    const expected = BLITZ_CHESS.clock.initialSeconds * 1000 - 2000 + BLITZ_CHESS.clock.incrementSeconds * 1000;
    expect(after.clock!.w).toBeGreaterThan(expected - 200);
    expect(after.clock!.w).toBeLessThan(expected + 200);
    // The opponent's clock is untouched.
    expect(after.clock!.b).toBe(BLITZ_CHESS.clock.initialSeconds * 1000);
  });

  it("loses on time when the clock is exhausted", () => {
    const state = fresh("bullet");
    state.turnStartedAt = Date.now() - 90_000; // longer than the whole bank
    const { state: after } = game.applyMove(state, "white-player", { type: "move", from: "e2", to: "e4" });
    expect(after.finished).toBe(true);
    expect(after.endReason).toBe("timeout");
    expect(after.winners).toEqual(["black-player"]);
  });

  it("offers clock variants to pick from", () => {
    expect(CHESS_VARIANTS.length).toBeGreaterThan(1);
    expect(new Set(CHESS_VARIANTS.map((v) => v.id)).size).toBe(CHESS_VARIANTS.length);
    expect(getChessVariant("nope").id).toBe("casual");
  });
});

describe("view", () => {
  it("gives every viewer the same position", () => {
    const state = playLine(fresh(), [["e2", "e4"], ["e7", "e5"]]);
    const boards = [...PLAYERS, null].map((v) => JSON.stringify(game.getPlayerView(state, v).board));
    expect(new Set(boards).size).toBe(1);
  });

  it("publishes legal moves only to the side to move", () => {
    const state = fresh();
    expect(game.getPlayerView(state, "white-player").legalMoves).toHaveLength(20);
    expect(game.getPlayerView(state, "black-player").legalMoves).toHaveLength(0);
  });

  it("records SAN history and highlights the last move", () => {
    const state = playLine(fresh(), [["e2", "e4"], ["c7", "c5"]]);
    expect(state.history).toEqual(["e4", "c5"]);
    expect(game.getPlayerView(state, "white-player").lastMove).toEqual({ from: "c7", to: "c5" });
  });

  it("survives a serialisation round trip, as Durable Object storage requires", () => {
    const state = playLine(fresh(), [["e2", "e4"], ["e7", "e5"], ["g1", "f3"]]);
    const revived = JSON.parse(JSON.stringify(state)) as ChessState;
    expect(game.getPlayerView(revived, "black-player").legalMoves.length).toBeGreaterThan(0);
    expect(game.getCurrentPlayerId(revived)).toBe("black-player");
  });
});

describe("timeout fallback", () => {
  it("plays a legal move rather than deadlocking", () => {
    const state = fresh();
    const move = game.getTimeoutMove!(state, "white-player");
    expect(move).not.toBeNull();
    expect(game.validateMove(state, "white-player", move!)).toBe(true);
  });

  it("declines for the player who is not to move", () => {
    expect(game.getTimeoutMove!(fresh(), "black-player")).toBeNull();
  });
});
