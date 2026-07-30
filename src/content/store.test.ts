import { describe, it, expect, beforeEach } from "vitest";
import {
  clearPacks,
  getTriviaPack,
  getWordPack,
  listPacks,
  packSize,
  PackError,
  registerPack,
  registerPacks,
  resolvePack,
  validatePack,
} from "./store";
import { BUNDLED, loadBundledPacks } from "./index";
import type { TriviaPack, WordPack } from "./types";

const words = (over: Partial<WordPack> = {}): unknown => ({
  kind: "words",
  id: "t-words",
  name: "Test",
  description: "d",
  locale: "en",
  words: Array.from({ length: 40 }, (_, i) => `WORD${i}`),
  ...over,
});

const trivia = (over: Partial<TriviaPack> = {}): unknown => ({
  kind: "trivia",
  id: "t-trivia",
  name: "Test",
  description: "d",
  locale: "en",
  questions: Array.from({ length: 5 }, (_, i) => ({
    id: `q${i}`,
    question: `Question ${i}?`,
    options: ["a", "b", "c"],
    answerIndex: 1,
  })),
  ...over,
});

describe("pack validation", () => {
  beforeEach(() => clearPacks());

  it("accepts a well-formed word pack", () => {
    expect(validatePack(words())).toMatchObject({ id: "t-words", kind: "words" });
  });

  it("rejects a pack with no id, name or locale", () => {
    expect(() => validatePack(words({ id: "" }))).toThrow(PackError);
    expect(() => validatePack(words({ name: "" }))).toThrow(PackError);
    expect(() => validatePack(words({ locale: "" }))).toThrow(PackError);
  });

  it("rejects a word pack too small to vary the board", () => {
    expect(() => validatePack(words({ words: ["A", "B", "C"] }))).toThrow(/at least 40/);
  });

  it("rejects duplicate words, which would put the same word twice on one grid", () => {
    const dupes = Array.from({ length: 40 }, (_, i) => `W${i}`);
    dupes[10] = "w3"; // same word, different case
    expect(() => validatePack(words({ words: dupes }))).toThrow(/duplicate/i);
  });

  it("rejects a trivia question whose answerIndex is out of range", () => {
    const bad = trivia();
    (bad as TriviaPack).questions[0]!.answerIndex = 7;
    expect(() => validatePack(bad)).toThrow(/answerIndex/);
  });

  it("rejects a trivia question with fewer than two options", () => {
    const bad = trivia();
    (bad as TriviaPack).questions[0]!.options = ["only"];
    expect(() => validatePack(bad)).toThrow(/2–6 options/);
  });

  it("rejects duplicate options within one question", () => {
    const bad = trivia();
    (bad as TriviaPack).questions[0]!.options = ["Lagos", "lagos", "Abuja"];
    expect(() => validatePack(bad)).toThrow(/duplicate/i);
  });

  it("rejects duplicate question ids, which would ask the same thing twice", () => {
    const bad = trivia() as TriviaPack;
    bad.questions[1]!.id = bad.questions[0]!.id;
    expect(() => validatePack(bad)).toThrow(/duplicate/i);
  });

  it("rejects an unknown kind", () => {
    expect(() => validatePack({ kind: "songs", id: "x" })).toThrow(/unknown pack kind/);
  });

  it("rejects a draw entry with no difficulty band", () => {
    expect(() =>
      validatePack({
        kind: "draw",
        id: "d",
        name: "D",
        description: "",
        locale: "en",
        words: Array.from({ length: 20 }, (_, i) => ({ word: `w${i}` })),
      })
    ).toThrow(/difficulty/);
  });
});

describe("the store", () => {
  beforeEach(() => clearPacks());

  it("keeps the good packs from a batch and reports the bad ones", () => {
    const result = registerPacks([words(), { kind: "words", id: "broken" }, trivia()]);
    expect(result.loaded).toEqual(["t-words", "t-trivia"]);
    expect(result.errors).toHaveLength(1);
  });

  it("replaces a pack with the same id — this is how a moderation fix lands", () => {
    registerPack(words());
    expect(getWordPack("t-words")!.words).toHaveLength(40);
    registerPack(words({ words: Array.from({ length: 60 }, (_, i) => `NEW${i}`) }));
    expect(getWordPack("t-words")!.words).toHaveLength(60);
    expect(getWordPack("t-words")!.words[0]).toBe("NEW0");
  });

  it("does not return a pack of the wrong kind", () => {
    registerPack(trivia());
    expect(getWordPack("t-trivia")).toBeNull();
    expect(getTriviaPack("t-trivia")).not.toBeNull();
  });

  it("lists packs without exposing any content", () => {
    registerPacks([words(), trivia()]);
    const listed = listPacks("words");
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("WORD0");
    expect(listed[0]!.size).toBe(40);
  });

  it("hides hidden packs from the picker but still loads them by id", () => {
    registerPack(words({ id: "secret", hidden: true }));
    expect(listPacks("words")).toHaveLength(0);
    expect(getWordPack("secret")).not.toBeNull();
  });

  it("falls back to another pack when the requested one has been withdrawn", () => {
    registerPack(words());
    // A room whose chosen pack is gone must still be able to deal.
    expect(resolvePack("words", "no-such-pack").id).toBe("t-words");
  });

  it("throws only when no pack of that kind exists at all", () => {
    expect(() => resolvePack("trivia", undefined)).toThrow(/no trivia packs/);
  });
});

describe("bundled content", () => {
  // The bundled set is what ships; every one of these must be valid or a real
  // room hits the failure instead of a test.
  beforeEach(() => {
    clearPacks();
    const { errors } = registerPacks(BUNDLED);
    expect(errors).toEqual([]);
  });

  it("ships word, draw and trivia packs including Nigerian sets", () => {
    expect(listPacks("words").map((p) => p.id)).toContain("words-naija");
    expect(listPacks("words").map((p) => p.id)).toContain("words-pidgin");
    expect(listPacks("draw").map((p) => p.id)).toContain("draw-naija");
    expect(listPacks("trivia").map((p) => p.id)).toContain("trivia-naija");
  });

  it("carries enough content to vary a match", () => {
    // A 25-word grid from a 30-word pack is the same board every time.
    for (const pack of listPacks("words")) expect(pack.size).toBeGreaterThanOrEqual(100);
    for (const pack of listPacks("draw")) expect(pack.size).toBeGreaterThanOrEqual(40);
    for (const pack of listPacks("trivia")) expect(pack.size).toBeGreaterThanOrEqual(20);
  });

  it("every bundled trivia answer points at a real option", () => {
    for (const id of ["trivia-general", "trivia-naija"]) {
      const pack = getTriviaPack(id)!;
      expect(pack).not.toBeNull();
      for (const q of pack.questions) {
        expect(q.options[q.answerIndex], `${id}/${q.id}`).toBeDefined();
      }
      expect(packSize(pack)).toBe(pack.questions.length);
    }
  });

  it("loadBundledPacks fills an empty store on its own", () => {
    clearPacks();
    expect(listPacks("trivia")).toHaveLength(0);
    loadBundledPacks({ force: true });
    expect(listPacks("trivia").length).toBeGreaterThan(0);
  });
});
