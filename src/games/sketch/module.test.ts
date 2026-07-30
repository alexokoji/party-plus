import { describe, it, expect } from "vitest";
import { sketchModule as game, solversOf, type SketchState } from "./module";
import {
  CLASSIC_SKETCH,
  editDistance,
  getSketchVariant,
  maskWord,
  normalizeGuess,
  QUICK_SKETCH,
  scoreGuess,
} from "./rules";

const FOUR = ["ada", "bola", "chidi", "dami"];

function fresh(players = FOUR, seed = 4, options: Record<string, unknown> = {}): SketchState {
  return game.createInitialState(players, { seed, now: Date.now(), ...options });
}

const drawerOf = (s: SketchState) => s.turn!.drawerId;
const guessersOf = (s: SketchState) => s.players.filter((id) => id !== drawerOf(s));

/** Gets past word selection so the state is mid-drawing. */
function drawing(s: SketchState, choice = 0): SketchState {
  return game.applyMove(s, drawerOf(s), { type: "chooseWord", index: choice }).state;
}

describe("setup", () => {
  it("runs from 3 to 12 players", () => {
    expect(game.meta.minPlayers).toBe(3);
    expect(game.meta.maxPlayers).toBe(12);
  });

  it("opens with the first drawer choosing a word", () => {
    const s = fresh();
    expect(s.phase).toBe("choosing");
    expect(s.turn!.choices).toHaveLength(CLASSIC_SKETCH.wordChoices);
    expect(s.round).toBe(1);
  });

  it("gives everyone a turn each round, in a shuffled order", () => {
    const s = fresh();
    expect([...s.order].sort()).toEqual([...FOUR].sort());
    const orders = new Set(Array.from({ length: 12 }, (_, i) => fresh(FOUR, i + 1).order.join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("uses the chosen pack", () => {
    const s = fresh(FOUR, 3, { pack: "draw-naija" });
    expect(s.packId).toBe("draw-naija");
  });

  it("starts everyone on zero", () => {
    expect(Object.values(fresh().scores)).toEqual([0, 0, 0, 0]);
  });
});

describe("the word is the secret", () => {
  it("shows the drawer their word and the shortlist", () => {
    const s = fresh();
    const view = game.getPlayerView(s, drawerOf(s));
    expect(view.choices).toHaveLength(CLASSIC_SKETCH.wordChoices);
    expect(view.canChoose).toBe(true);
  });

  it("shows guessers neither the word nor the shortlist", () => {
    const s = fresh();
    for (const id of guessersOf(s)) {
      const view = game.getPlayerView(s, id);
      expect(view.word).toBeNull();
      expect(view.choices).toBeNull();
      const wire = JSON.stringify(view);
      for (const choice of s.turn!.choices) expect(wire).not.toContain(choice);
    }
  });

  it("shows a spectator nothing either", () => {
    const s = drawing(fresh());
    const view = game.getPlayerView(s, null);
    expect(view.word).toBeNull();
    expect(view.choices).toBeNull();
    expect(JSON.stringify(view)).not.toContain(s.turn!.word);
  });

  it("gives guessers a mask, not the word", () => {
    const s = drawing(fresh());
    const view = game.getPlayerView(s, guessersOf(s)[0]!);
    expect(view.word).toBeNull();
    expect(view.wordMask).not.toBeNull();
    expect(view.wordMask).toMatch(/_/);
    // Same shape, none of the letters.
    expect(view.wordMask!.length).toBe(s.turn!.word.length);
    expect(view.wordMask).not.toBe(s.turn!.word);
  });

  it("keeps the word out of the drawer's own view until they choose it", () => {
    const s = fresh();
    const view = game.getPlayerView(s, guessersOf(s)[0]!);
    expect(view.wordMask).toBeNull();
  });

  it("publishes the word once the turn is over", () => {
    let s = drawing(fresh());
    const word = s.turn!.word;
    s = game.advancePhase!(s, s.phaseEndsAt)!.state;
    expect(s.phase).toBe("between");
    for (const id of [...FOUR, null]) {
      expect(game.getPlayerView(s, id).word).toBe(word);
    }
  });

  it("never publishes the text of a CORRECT guess — that is the word", () => {
    const s = drawing(fresh());
    const word = s.turn!.word;
    const { state: after, events } = game.applyMove(s, guessersOf(s)[0]!, { type: "guess", text: word });
    const entry = after.turn!.guesses[0]!;
    expect(entry.correct).toBe(true);
    expect(entry.text).toBeNull();
    expect(JSON.stringify(events)).not.toContain(word);
    // And it stays out of everyone else's view.
    const view = game.getPlayerView(after, guessersOf(s)[1]!);
    expect(JSON.stringify(view)).not.toContain(word);
  });

  it("does publish wrong guesses, which is half the fun", () => {
    const s = drawing(fresh());
    const after = game.applyMove(s, guessersOf(s)[0]!, { type: "guess", text: "banana boat" }).state;
    expect(after.turn!.guesses[0]!.text).toBe("banana boat");
    expect(game.getPlayerView(after, guessersOf(s)[1]!).guesses[0]!.text).toBe("banana boat");
  });
});

describe("guessing", () => {
  it("matches ignoring case, spacing and punctuation", () => {
    const s = drawing(fresh(FOUR, 4, { pack: "draw-naija" }));
    const word = s.turn!.word;
    const mangled = ` ${word.toUpperCase().replace(/ /g, "-")} `;
    const after = game.applyMove(s, guessersOf(s)[0]!, { type: "guess", text: mangled }).state;
    expect(after.turn!.guesses[0]!.correct).toBe(true);
  });

  it("tells a guesser they are close without saying what is missing", () => {
    const s = drawing(fresh());
    const word = s.turn!.word;
    const nearly = word.slice(0, -1); // one letter short
    const after = game.applyMove(s, guessersOf(s)[0]!, { type: "guess", text: nearly }).state;
    const entry = after.turn!.guesses[0]!;
    expect(entry.correct).toBe(false);
    expect(entry.close).toBe(true);
  });

  it("does not let the drawer guess their own word", () => {
    const s = drawing(fresh());
    expect(game.validateMove(s, drawerOf(s), { type: "guess", text: s.turn!.word })).toBe(false);
  });

  it("does not let someone guess twice once they have it", () => {
    const s = drawing(fresh());
    const guesser = guessersOf(s)[0]!;
    const after = game.applyMove(s, guesser, { type: "guess", text: s.turn!.word }).state;
    expect(game.validateMove(after, guesser, { type: "guess", text: s.turn!.word })).toBe(false);
    // But a guesser who is still wrong may keep trying.
    expect(game.validateMove(after, guessersOf(s)[1]!, { type: "guess", text: "again" })).toBe(true);
  });

  it("refuses guesses outside the drawing phase", () => {
    const s = fresh();
    expect(game.validateMove(s, guessersOf(s)[0]!, { type: "guess", text: "early" })).toBe(false);
  });

  it("refuses empty and absurdly long guesses", () => {
    const s = drawing(fresh());
    const guesser = guessersOf(s)[0]!;
    expect(game.validateMove(s, guesser, { type: "guess", text: "   " })).toBe(false);
    expect(game.validateMove(s, guesser, { type: "guess", text: "x".repeat(200) })).toBe(false);
  });

  it("refuses guesses from someone who is not in the match", () => {
    const s = drawing(fresh());
    expect(game.validateMove(s, "stranger", { type: "guess", text: "hello" })).toBe(false);
  });

  it("ends the turn as soon as everyone has solved it", () => {
    let s = drawing(fresh());
    const word = s.turn!.word;
    for (const id of guessersOf(s)) {
      s = game.applyMove(s, id, { type: "guess", text: word }).state;
    }
    expect(s.phase).toBe("between");
  });
});

describe("scoring", () => {
  it("pays the first solver more than the fourth", () => {
    const total = CLASSIC_SKETCH.drawSeconds * 1000;
    expect(scoreGuess(CLASSIC_SKETCH, 0, total, total)).toBeGreaterThan(
      scoreGuess(CLASSIC_SKETCH, 3, total, total)
    );
  });

  it("pays a fast guess more than a slow one", () => {
    const total = CLASSIC_SKETCH.drawSeconds * 1000;
    expect(scoreGuess(CLASSIC_SKETCH, 0, total, total)).toBeGreaterThan(
      scoreGuess(CLASSIC_SKETCH, 0, total * 0.1, total)
    );
  });

  it("never pays less than the floor, however late", () => {
    expect(scoreGuess(CLASSIC_SKETCH, 9, 0, 1000)).toBe(CLASSIC_SKETCH.minGuessPoints);
  });

  it("pays the drawer per person who got it", () => {
    let s = drawing(fresh());
    const drawer = drawerOf(s);
    const word = s.turn!.word;
    const [first, second] = guessersOf(s);
    s = game.applyMove(s, first!, { type: "guess", text: word }).state;
    s = game.applyMove(s, second!, { type: "guess", text: word }).state;
    expect(s.scores[drawer]).toBe(0); // not paid until the turn ends
    s = game.advancePhase!(s, s.phaseEndsAt)!.state;
    expect(s.scores[drawer]).toBe(2 * CLASSIC_SKETCH.drawerPointsPerGuess);
  });

  it("pays the drawer nothing when nobody gets it", () => {
    let s = drawing(fresh());
    const drawer = drawerOf(s);
    s = game.advancePhase!(s, s.phaseEndsAt)!.state;
    expect(s.scores[drawer]).toBe(0);
  });

  it("scores a correct guess immediately", () => {
    const s = drawing(fresh());
    const guesser = guessersOf(s)[0]!;
    const after = game.applyMove(s, guesser, { type: "guess", text: s.turn!.word }).state;
    expect(after.scores[guesser]).toBeGreaterThan(0);
  });

  it("scores a wrong guess at nothing", () => {
    const s = drawing(fresh());
    const guesser = guessersOf(s)[0]!;
    const after = game.applyMove(s, guesser, { type: "guess", text: "definitely not it" }).state;
    expect(after.scores[guesser]).toBe(0);
  });
});

describe("the live drawing channel", () => {
  it("lets the drawer stream while drawing", () => {
    const s = drawing(fresh());
    expect(game.authorizeStream!(s, drawerOf(s), "draw", {})).toBe(true);
  });

  it("refuses everyone else — nobody scribbles on someone else's turn", () => {
    const s = drawing(fresh());
    for (const id of guessersOf(s)) {
      expect(game.authorizeStream!(s, id, "draw", {})).toBe(false);
    }
  });

  it("refuses the drawer before and after their drawing phase", () => {
    const choosing = fresh();
    expect(game.authorizeStream!(choosing, drawerOf(choosing), "draw", {})).toBe(false);

    let s = drawing(fresh());
    const drawer = drawerOf(s);
    s = game.advancePhase!(s, s.phaseEndsAt)!.state;
    expect(s.phase).toBe("between");
    expect(game.authorizeStream!(s, drawer, "draw", {})).toBe(false);
  });

  it("refuses any channel but the drawing one", () => {
    const s = drawing(fresh());
    expect(game.authorizeStream!(s, drawerOf(s), "whispers", {})).toBe(false);
    expect(game.authorizeStream!(s, drawerOf(s), "", {})).toBe(false);
  });
});

describe("hints", () => {
  it("masks every letter at first, keeping spaces visible", () => {
    expect(maskWord("moi moi", [])).toBe("___ ___");
    expect(maskWord("go slow", [0])).toBe("g_ ____");
  });

  it("reveals letters as the clock runs down", () => {
    let s = drawing(fresh());
    const total = CLASSIC_SKETCH.drawSeconds * 1000;
    // 50% left: past the first hint threshold (0.6), before the second (0.3).
    const advanced = game.advancePhase!(s, s.phaseEndsAt - total * 0.5);
    expect(advanced).not.toBeNull();
    s = advanced!.state;
    expect(s.turn!.hints).toHaveLength(1);

    const second = game.advancePhase!(s, s.phaseEndsAt - total * 0.2)!;
    expect(second.state.turn!.hints).toHaveLength(2);
  });

  it("does not hand over the last letter", () => {
    const s = drawing(fresh());
    // A word of n letters can never have all n revealed as hints.
    let state = s;
    for (let i = 0; i < 40; i++) {
      const step = game.advancePhase!(state, state.phaseEndsAt - 1000);
      if (!step) break;
      state = step.state;
    }
    const letters = state.turn!.word.replace(/[^a-zA-Z0-9]/g, "").length;
    expect(state.turn!.hints.length).toBeLessThan(letters);
    expect(game.getPlayerView(state, guessersOf(s)[0]!).wordMask).toMatch(/_/);
  });
});

describe("turn and match flow", () => {
  it("starts drawing when the word is chosen", () => {
    const s = drawing(fresh());
    expect(s.phase).toBe("drawing");
    expect(s.turn!.word).toBe(fresh().turn!.choices[0]);
  });

  it("starts anyway if the drawer never chooses", () => {
    const s = fresh();
    const after = game.advancePhase!(s, s.phaseEndsAt)!.state;
    expect(after.phase).toBe("drawing");
    expect(after.turn!.word).toBe(s.turn!.choices[0]);
  });

  it("lets a drawer pass their turn", () => {
    const s = fresh();
    const after = game.applyMove(s, drawerOf(s), { type: "skipTurn" }).state;
    expect(after.phase).toBe("between");
  });

  it("moves to the next drawer after the gap", () => {
    let s = drawing(fresh());
    const first = drawerOf(s);
    s = game.advancePhase!(s, s.phaseEndsAt)!.state; // end of drawing
    s = game.advancePhase!(s, s.phaseEndsAt)!.state; // end of the gap
    expect(s.phase).toBe("choosing");
    expect(drawerOf(s)).not.toBe(first);
  });

  it("never repeats a word within a match", () => {
    let s = fresh(FOUR, 6, { variant: "quick" });
    const words: string[] = [];
    for (let guard = 0; guard < 100 && !s.finished; guard++) {
      if (s.phase === "drawing" && s.turn && !words.includes(s.turn.word)) words.push(s.turn.word);
      s = game.advancePhase!(s, s.phaseEndsAt)?.state ?? s;
    }
    expect(new Set(words).size).toBe(words.length);
  });

  it("puts the drawer on the clock only while choosing", () => {
    const s = fresh();
    expect(game.getCurrentPlayerId(s)).toBe(drawerOf(s));
    expect(game.getCurrentPlayerId(drawing(s))).toBeNull();
  });

  it("plays a full match and crowns the highest scorer", () => {
    let s = fresh(FOUR, 8, { variant: "quick" });
    const winner = "ada";
    for (let guard = 0; guard < 400 && !s.finished; guard++) {
      if (s.phase === "drawing" && s.turn && drawerOf(s) !== winner && !solversOf(s.turn).includes(winner)) {
        s = game.applyMove(s, winner, { type: "guess", text: s.turn.word }).state;
        continue;
      }
      const step = game.advancePhase!(s, s.phaseEndsAt);
      if (!step) break;
      s = step.state;
    }
    expect(s.finished).toBe(true);
    expect(s.round).toBe(QUICK_SKETCH.rounds + 1);
    expect(s.winners).toEqual([winner]);
    expect(game.checkWinCondition(s)).toMatchObject({ finished: true, winners: [winner] });
  });

  it("gives everyone the same number of turns", () => {
    let s = fresh(FOUR, 12, { variant: "quick" });
    for (let guard = 0; guard < 400 && !s.finished; guard++) {
      s = game.advancePhase!(s, s.phaseEndsAt)?.state ?? s;
    }
    expect(s.finished).toBe(true);
    const turns = s.past.reduce<Record<string, number>>((acc, t) => {
      acc[t.drawerId] = (acc[t.drawerId] ?? 0) + 1;
      return acc;
    }, {});
    expect(Object.values(turns)).toEqual([QUICK_SKETCH.rounds, QUICK_SKETCH.rounds, QUICK_SKETCH.rounds, QUICK_SKETCH.rounds]);
  });

  it("never leaks the word at any point of a real match", () => {
    let s = fresh(FOUR, 15, { variant: "quick" });
    for (let guard = 0; guard < 400 && !s.finished; guard++) {
      if (s.turn && s.phase === "drawing") {
        const word = s.turn.word;
        for (const id of s.players.filter((p) => p !== s.turn!.drawerId)) {
          expect(JSON.stringify(game.getPlayerView(s, id))).not.toContain(word);
        }
        expect(JSON.stringify(game.getPlayerView(s, null))).not.toContain(word);
      }
      s = game.advancePhase!(s, s.phaseEndsAt)?.state ?? s;
    }
    expect(s.finished).toBe(true);
  });
});

describe("guess normalisation", () => {
  it("strips case, spaces, hyphens and accents", () => {
    expect(normalizeGuess("Moi-Moi")).toBe(normalizeGuess("moi moi"));
    expect(normalizeGuess("  JOLLOF  ")).toBe("jollof");
    expect(normalizeGuess("café")).toBe("cafe");
  });

  it("does not collapse genuinely different words", () => {
    expect(normalizeGuess("suya")).not.toBe(normalizeGuess("soya"));
  });

  it("measures edit distance up to the cap and then gives up cheaply", () => {
    expect(editDistance("okada", "okada")).toBe(0);
    expect(editDistance("okada", "okado")).toBe(1);
    expect(editDistance("okada", "completely different", 3)).toBeGreaterThan(3);
  });
});

describe("variants", () => {
  it("offers three formats with different lengths", () => {
    expect(getSketchVariant("quick").rounds).toBeLessThan(getSketchVariant("marathon").rounds);
    expect(getSketchVariant(undefined).id).toBe("classic");
    expect(getSketchVariant("nonsense").id).toBe("classic");
  });

  it("marathon offers more words to choose from", () => {
    expect(getSketchVariant("marathon").wordChoices).toBeGreaterThan(CLASSIC_SKETCH.wordChoices);
    expect(fresh(FOUR, 4, { variant: "marathon" }).turn!.choices).toHaveLength(4);
  });
});
