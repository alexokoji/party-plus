import { describe, it, expect } from "vitest";
import { leaderboard, outstanding, triviaModule as game, type TriviaState } from "./module";
import { BLITZ_TRIVIA, CLASSIC_TRIVIA, getTriviaVariant, MARATHON_TRIVIA, scoreAnswer } from "./rules";

const FOUR = ["ada", "bola", "chidi", "dami"];

function fresh(players = FOUR, seed = 5, options: Record<string, unknown> = {}): TriviaState {
  return game.createInitialState(players, { seed, now: Date.now(), ...options });
}

const correctIndexOf = (s: TriviaState) => s.rounds[s.current]!.question.answerIndex;
const wrongIndexOf = (s: TriviaState) => (correctIndexOf(s) + 1) % s.rounds[s.current]!.question.options.length;

/** Answers for everyone, so the question closes. */
function everyoneAnswers(s: TriviaState, pick: (id: string) => number): TriviaState {
  let next = s;
  for (const id of s.players) {
    next = game.applyMove(next, id, { type: "answer", optionIndex: pick(id) }).state;
  }
  return next;
}

describe("setup", () => {
  it("runs from 2 players up to a full lobby", () => {
    expect(game.meta.minPlayers).toBe(2);
    expect(game.meta.maxPlayers).toBe(12);
  });

  it("deals the variant's number of questions", () => {
    expect(fresh().rounds).toHaveLength(CLASSIC_TRIVIA.questionCount);
    expect(fresh(FOUR, 5, { variant: "blitz" }).rounds).toHaveLength(BLITZ_TRIVIA.questionCount);
    expect(fresh(FOUR, 5, { variant: "marathon" }).rounds).toHaveLength(MARATHON_TRIVIA.questionCount);
  });

  it("never asks the same question twice in a match", () => {
    const s = fresh(FOUR, 11, { variant: "marathon" });
    const ids = s.rounds.map((r) => r.question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("asks a different set each match", () => {
    const a = fresh(FOUR, 1).rounds.map((r) => r.question.id).join();
    const b = fresh(FOUR, 2).rounds.map((r) => r.question.id).join();
    expect(a).not.toBe(b);
  });

  it("uses the chosen pack", () => {
    const s = fresh(FOUR, 3, { pack: "trivia-naija" });
    expect(s.packId).toBe("trivia-naija");
    expect(s.rounds.every((r) => /^(ng|af)-/.test(r.question.id))).toBe(true);
  });

  it("falls back to a real pack when the chosen one is withdrawn", () => {
    const s = fresh(FOUR, 3, { pack: "nope" });
    expect(s.rounds.length).toBeGreaterThan(0);
  });

  it("shuffles the options so the answer is not always in the same slot", () => {
    // Across many matches the correct index must move around; a pack whose
    // answers all sat at index 1 would otherwise be trivially guessable.
    const positions = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      for (const round of fresh(FOUR, seed).rounds) positions.add(round.question.answerIndex);
    }
    expect(positions.size).toBeGreaterThan(1);
  });

  it("keeps the option set intact when shuffling", () => {
    const s = fresh();
    for (const round of s.rounds) {
      const q = round.question;
      expect(q.options[q.answerIndex]).toBeDefined();
      expect(new Set(q.options).size).toBe(q.options.length);
    }
  });

  it("starts everyone on zero", () => {
    const s = fresh();
    expect(Object.values(s.scores)).toEqual([0, 0, 0, 0]);
  });
});

describe("the answer key never leaves the server", () => {
  it("sends the question and options but not the answer", () => {
    const s = fresh();
    const view = game.getPlayerView(s, "ada");
    expect(view.question!.text.length).toBeGreaterThan(0);
    expect(view.question!.options.length).toBeGreaterThanOrEqual(2);
    expect(view.reveal).toBeNull();
    expect(JSON.stringify(view)).not.toContain("answerIndex");
  });

  it("does not leak the answer to a spectator either", () => {
    const view = game.getPlayerView(fresh(), null);
    expect(view.reveal).toBeNull();
    expect(JSON.stringify(view)).not.toContain("answerIndex");
    expect(view.canAnswer).toBe(false);
  });

  it("does not leak the answers to LATER questions", () => {
    const s = fresh();
    const wire = JSON.stringify(game.getPlayerView(s, "ada"));
    // Only the open question may appear at all.
    for (const round of s.rounds.slice(1)) {
      expect(wire).not.toContain(round.question.question);
    }
  });

  it("does not tell you whether you were right until the question closes", () => {
    const s = game.applyMove(fresh(), "ada", { type: "answer", optionIndex: 0 }).state;
    const view = game.getPlayerView(s, "ada");
    expect(view.myAnswer).toBe(0);
    expect(view.reveal).toBeNull();
    expect(view.leaderboard.every((r) => r.lastAnswerCorrect === null)).toBe(true);
  });

  it("emits no event that betrays whether an answer was correct", () => {
    const s = fresh();
    const { events } = game.applyMove(s, "ada", { type: "answer", optionIndex: correctIndexOf(s) });
    const wire = JSON.stringify(events);
    expect(wire).not.toContain("correct");
    expect(wire).not.toContain(String(correctIndexOf(s)));
  });

  it("shows the key only once the question is closed", () => {
    const s = everyoneAnswers(fresh(), () => 0);
    expect(s.phase).toBe("reveal");
    const view = game.getPlayerView(s, "ada");
    expect(view.reveal!.correctIndex).toBe(s.rounds[s.current]!.question.answerIndex);
    expect(view.canAnswer).toBe(false);
  });
});

describe("answering", () => {
  it("accepts one answer per player and no more", () => {
    const s = fresh();
    expect(game.validateMove(s, "ada", { type: "answer", optionIndex: 0 })).toBe(true);
    const after = game.applyMove(s, "ada", { type: "answer", optionIndex: 0 }).state;
    expect(game.validateMove(after, "ada", { type: "answer", optionIndex: 1 })).toBe(false);
  });

  it("refuses an option that does not exist", () => {
    const s = fresh();
    const count = s.rounds[0]!.question.options.length;
    expect(game.validateMove(s, "ada", { type: "answer", optionIndex: count })).toBe(false);
    expect(game.validateMove(s, "ada", { type: "answer", optionIndex: -1 })).toBe(false);
    expect(game.validateMove(s, "ada", { type: "answer", optionIndex: 1.5 })).toBe(false);
  });

  it("refuses answers from someone who is not in the match", () => {
    expect(game.validateMove(fresh(), "gatecrasher", { type: "answer", optionIndex: 0 })).toBe(false);
  });

  it("refuses answers once the question has closed", () => {
    const s = everyoneAnswers(fresh(), () => 0);
    expect(game.validateMove(s, "ada", { type: "answer", optionIndex: 1 })).toBe(false);
  });

  it("scores a correct answer and leaves a wrong one at zero", () => {
    const s = fresh();
    const right = game.applyMove(s, "ada", { type: "answer", optionIndex: correctIndexOf(s) }).state;
    expect(right.scores.ada).toBeGreaterThan(0);
    const wrong = game.applyMove(s, "bola", { type: "answer", optionIndex: wrongIndexOf(s) }).state;
    expect(wrong.scores.bola).toBe(0);
  });

  it("applies the wrong-answer penalty only in the variant that has one", () => {
    const s = fresh(FOUR, 5, { variant: "marathon" });
    const after = game.applyMove(s, "ada", { type: "answer", optionIndex: wrongIndexOf(s) }).state;
    expect(after.scores.ada).toBe(-MARATHON_TRIVIA.wrongPenalty);
  });

  it("lets a player pass without scoring", () => {
    const s = fresh();
    const after = game.applyMove(s, "ada", { type: "skip" }).state;
    expect(after.scores.ada).toBe(0);
    expect(outstanding(after)).not.toContain("ada");
  });

  it("closes the question as soon as everybody has answered", () => {
    const s = fresh();
    expect(s.phase).toBe("question");
    const after = everyoneAnswers(s, () => 0);
    expect(after.phase).toBe("reveal");
  });

  it("tracks streaks and breaks them on a miss or a no-show", () => {
    let s = fresh(["ada", "bola"], 5);
    s = everyoneAnswers(s, (id) => (id === "ada" ? correctIndexOf(s) : wrongIndexOf(s)));
    expect(s.streaks.ada).toBe(1);
    expect(s.streaks.bola).toBe(0);

    s = game.advancePhase!(s, s.phaseEndsAt)!.state; // on to question 2
    s = game.applyMove(s, "ada", { type: "answer", optionIndex: correctIndexOf(s) }).state;
    expect(s.streaks.ada).toBe(2);

    // Bola never answers; the clock closes the question and breaks nothing
    // that was not already broken, but Ada's streak survives.
    s = game.advancePhase!(s, s.phaseEndsAt)!.state;
    expect(s.streaks.ada).toBe(2);
    expect(s.streaks.bola).toBe(0);
  });
});

describe("speed scoring", () => {
  it("pays more the sooner you answer", () => {
    const instant = scoreAnswer(CLASSIC_TRIVIA, 0);
    const halfway = scoreAnswer(CLASSIC_TRIVIA, CLASSIC_TRIVIA.secondsPerQuestion * 500);
    const late = scoreAnswer(CLASSIC_TRIVIA, CLASSIC_TRIVIA.secondsPerQuestion * 1000);
    expect(instant).toBe(CLASSIC_TRIVIA.basePoints + CLASSIC_TRIVIA.speedPoints);
    expect(halfway).toBeLessThan(instant);
    expect(halfway).toBeGreaterThan(late);
    expect(late).toBe(CLASSIC_TRIVIA.basePoints);
  });

  it("cannot be gamed by a clock that claims a negative or huge elapsed time", () => {
    expect(scoreAnswer(CLASSIC_TRIVIA, -10_000)).toBe(CLASSIC_TRIVIA.basePoints + CLASSIC_TRIVIA.speedPoints);
    expect(scoreAnswer(CLASSIC_TRIVIA, 10 ** 9)).toBe(CLASSIC_TRIVIA.basePoints);
  });

  it("weights blitz heavily towards speed", () => {
    expect(BLITZ_TRIVIA.speedPoints).toBeGreaterThan(BLITZ_TRIVIA.basePoints);
  });

  it("gives a faster correct answer more points than a slower one in a real round", () => {
    const s = fresh();
    const round = s.rounds[0]!;
    // Rig the open time so "now" is measurably later for the second answer.
    const early = game.applyMove({ ...s }, "ada", { type: "answer", optionIndex: correctIndexOf(s) }).state;
    const lateState: TriviaState = structuredClone(s);
    lateState.rounds[0]!.openedAt = round.openedAt - 15_000;
    const late = game.applyMove(lateState, "bola", { type: "answer", optionIndex: correctIndexOf(s) }).state;
    expect(early.scores.ada!).toBeGreaterThan(late.scores.bola!);
  });
});

describe("the leaderboard", () => {
  it("sorts by score, highest first", () => {
    const s = fresh();
    const after = everyoneAnswers(s, (id) => (id === "ada" ? correctIndexOf(s) : wrongIndexOf(s)));
    const board = leaderboard(after);
    expect(board[0]!.playerId).toBe("ada");
    expect(board[0]!.score).toBeGreaterThan(board[1]!.score);
  });

  it("reports each player's last answer during the reveal", () => {
    const s = fresh();
    const after = everyoneAnswers(s, (id) => (id === "ada" ? correctIndexOf(s) : wrongIndexOf(s)));
    const rows = game.getPlayerView(after, "ada").leaderboard;
    expect(rows.find((r) => r.playerId === "ada")!.lastAnswerCorrect).toBe(true);
    expect(rows.find((r) => r.playerId === "bola")!.lastAnswerCorrect).toBe(false);
  });

  it("shows how the votes split once the question closes", () => {
    const s = fresh();
    const after = everyoneAnswers(s, () => 0);
    const reveal = game.getPlayerView(after, "ada").reveal!;
    expect(reveal.counts[0]).toBe(4);
    expect(reveal.counts.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("includes everyone, even players who never answered", () => {
    const s = fresh();
    expect(game.getPlayerView(s, "ada").leaderboard).toHaveLength(4);
  });
});

describe("the phase clock", () => {
  it("nobody is 'on turn' — everyone answers at once", () => {
    expect(game.getCurrentPlayerId(fresh())).toBeNull();
  });

  it("closes an unanswered question when the clock runs out", () => {
    const s = fresh();
    const after = game.advancePhase!(s, s.phaseEndsAt)!.state;
    expect(after.phase).toBe("reveal");
    expect(after.current).toBe(0);
  });

  it("moves on to the next question after the reveal", () => {
    let s = everyoneAnswers(fresh(), () => 0);
    expect(s.phase).toBe("reveal");
    s = game.advancePhase!(s, s.phaseEndsAt)!.state;
    expect(s.phase).toBe("question");
    expect(s.current).toBe(1);
    expect(game.getPlayerView(s, "ada").questionNumber).toBe(2);
  });

  it("does nothing before the deadline", () => {
    const s = fresh();
    expect(game.advancePhase!(s, s.phaseEndsAt - 1000)).toBeNull();
  });

  it("stops scheduling once the match is over", () => {
    const s: TriviaState = { ...fresh(), finished: true };
    expect(game.getPhaseDeadline!(s)).toBeNull();
    expect(game.advancePhase!(s, Date.now())).toBeNull();
  });
});

describe("full matches", () => {
  /** Plays every question through, with a given answer strategy. */
  function playOut(seed: number, pick: (s: TriviaState, id: string) => number): TriviaState {
    let s = fresh(FOUR, seed);
    for (let guard = 0; guard < 200 && !s.finished; guard++) {
      if (s.phase === "question") {
        for (const id of outstanding(s)) {
          s = game.applyMove(s, id, { type: "answer", optionIndex: pick(s, id) }).state;
        }
      } else {
        s = game.advancePhase!(s, s.phaseEndsAt)!.state;
      }
    }
    return s;
  }

  it("ends after the last question with the highest scorer winning", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const s = playOut(seed, (state, id) =>
        id === "ada" ? state.rounds[state.current]!.question.answerIndex : 0
      );
      expect(s.finished, `seed ${seed}`).toBe(true);
      expect(s.current).toBe(s.rounds.length - 1);
      expect(s.winners).toEqual(["ada"]);
      expect(s.scores.ada).toBeGreaterThan(0);
    }
  });

  it("declares a tie when scores are level", () => {
    // Everyone answers identically, so everyone scores identically.
    const s = playOut(4, (state) => state.rounds[state.current]!.question.answerIndex);
    expect(s.finished).toBe(true);
    expect(s.winners.sort()).toEqual([...FOUR].sort());
  });

  it("never leaks an unanswered question's key at any point", () => {
    let s = fresh(FOUR, 9);
    for (let guard = 0; guard < 200 && !s.finished; guard++) {
      for (const id of [...FOUR, null]) {
        const view = game.getPlayerView(s, id);
        if (view.phase === "question") {
          expect(view.reveal).toBeNull();
          expect(JSON.stringify(view)).not.toContain("answerIndex");
        }
      }
      s =
        s.phase === "question"
          ? game.applyMove(s, outstanding(s)[0]!, { type: "answer", optionIndex: 0 }).state
          : game.advancePhase!(s, s.phaseEndsAt)!.state;
    }
    expect(s.finished).toBe(true);
  });

  it("plays a whole Naija pack match", () => {
    let s = fresh(FOUR, 2, { pack: "trivia-naija", variant: "blitz" });
    for (let guard = 0; guard < 300 && !s.finished; guard++) {
      s =
        s.phase === "question"
          ? game.advancePhase!(s, s.phaseEndsAt)!.state
          : game.advancePhase!(s, s.phaseEndsAt)!.state;
    }
    expect(s.finished).toBe(true);
    expect(s.rounds).toHaveLength(BLITZ_TRIVIA.questionCount);
  });

  it("trims the match to the pack when the pack is short", () => {
    const short = getTriviaVariant("marathon");
    const s = fresh(FOUR, 1, { variant: "marathon", pack: "trivia-general" });
    expect(s.rounds.length).toBeLessThanOrEqual(short.questionCount);
    expect(s.rounds.length).toBeGreaterThan(0);
  });
});
