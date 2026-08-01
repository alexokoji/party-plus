import { describe, it, expect } from "vitest";
import { letterStates, playableWords, scoreFor, scoreGuess, isWin, MAX_ATTEMPTS } from "./rules";

describe("scoring a guess", () => {
  it("marks letters in the right place", () => {
    expect(scoreGuess("OKADA", "OKADA")).toEqual(["right", "right", "right", "right", "right"]);
    expect(isWin(scoreGuess("OKADA", "OKADA"))).toBe(true);
  });

  it("marks letters that are present but elsewhere", () => {
    expect(scoreGuess("SUYA", "YAMS")).toEqual(["moved", "absent", "moved", "moved"]);
  });

  it("marks letters that are not there at all", () => {
    expect(scoreGuess("ZZZZ", "SUYA")).toEqual(["absent", "absent", "absent", "absent"]);
  });

  /**
   * The case every implementation of this gets wrong, and the reason the rules
   * live in their own file: a repeated letter must not claim credit the answer
   * cannot pay.
   */
  it("does not over-credit a repeated letter", () => {
    // One O in the answer, two in the guess: exactly one may be marked.
    const marks = scoreGuess("OOKAY", "OKADA");
    expect(marks[0]).toBe("right");
    expect(marks[1]).toBe("absent");
  });

  it("gives an exact match priority over an earlier duplicate", () => {
    // The second L is in place, so the first must not steal the credit.
    const marks = scoreGuess("LLAMA", "ALLOY");
    expect(marks[1]).toBe("right");
    expect(marks[0]).toBe("moved");
  });

  it("handles two copies in both guess and answer", () => {
    const marks = scoreGuess("EGGED", "LEDGE");
    expect(marks.filter((m) => m !== "absent").length).toBe(4);
  });

  it("ignores case on both sides", () => {
    expect(scoreGuess("okada", "OKADA").every((m) => m === "right")).toBe(true);
  });
});

describe("the keyboard's memory", () => {
  it("keeps the best mark a letter has earned", () => {
    const states = letterStates([
      { word: "SUYA", marks: ["absent", "absent", "moved", "absent"] },
      { word: "YAMS", marks: ["right", "absent", "absent", "absent"] },
    ]);
    // Y was "moved" once and "right" later: it must not go backwards.
    expect(states.Y).toBe("right");
    expect(states.S).toBe("absent");
  });

  it("is empty before anyone guesses", () => {
    expect(letterStates([])).toEqual({});
  });
});

describe("choosing words", () => {
  it("takes only single words of the right length", () => {
    // PORT HARCOURT and MOI MOI have spaces; SUYA, ZOBO and EBA are the wrong
    // length; OKADA appears twice. One answer survives.
    const words = playableWords(
      ["OKADA", "PORT HARCOURT", "SUYA", "MOI MOI", "ZOBO", "EBA", "OKADA"],
      5
    );
    expect(words).toEqual(["OKADA"]);
  });

  it("rejects anything with a space, a hyphen or the wrong length", () => {
    const words = playableWords(["ASO ROCK", "KEKE-NAPEP", "EBA", "JOLLOF"], 6);
    expect(words).toEqual(["JOLLOF"]);
  });

  it("drops duplicates so one answer cannot appear twice", () => {
    expect(playableWords(["JOLLOF", "jollof", "JOLLOF"], 6)).toEqual(["JOLLOF"]);
  });

  it("finds real answers in the shipped packs", async () => {
    const { registerPacks, clearPacks, getWordPack } = await import("../../content/store");
    const { BUNDLED } = await import("../../content/index");
    clearPacks();
    registerPacks(BUNDLED);
    for (const id of ["words-general", "words-naija", "words-pidgin"]) {
      const pack = getWordPack(id);
      expect(pack, id).not.toBeNull();
      // A pack with only a handful of usable answers would repeat itself
      // within a sitting.
      expect(playableWords(pack!.words, 5).length, id).toBeGreaterThan(5);
    }
  });
});

describe("points", () => {
  it("pays more for solving it sooner", () => {
    expect(scoreFor(1)).toBeGreaterThan(scoreFor(3));
    expect(scoreFor(3)).toBeGreaterThan(scoreFor(MAX_ATTEMPTS));
  });

  it("never pays nothing for a solve", () => {
    expect(scoreFor(MAX_ATTEMPTS)).toBeGreaterThan(0);
  });
});
