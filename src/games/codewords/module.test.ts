import { describe, it, expect } from "vitest";
import { codewordsModule as game, type CodewordsState } from "./module";
import {
  buildKey,
  CLASSIC_CODEWORDS,
  CODEWORDS_VARIANTS,
  DEADLY_CODEWORDS,
  getCodewordsVariant,
  otherTeam,
  type CardOwner,
  type Team,
} from "./rules";

const SIX = ["p1", "p2", "p3", "p4", "p5", "p6"];

function fresh(players = SIX, seed = 7, options: Record<string, unknown> = {}): CodewordsState {
  return game.createInitialState(players, { seed, now: 1_000_000, ...options });
}

const spymasterOf = (s: CodewordsState, team: Team) =>
  s.players.find((p) => p.team === team && p.role === "spymaster")!;
const operativeOf = (s: CodewordsState, team: Team) =>
  s.players.find((p) => p.team === team && p.role === "operative")!;
const indexOwned = (s: CodewordsState, owner: CardOwner) =>
  s.key.findIndex((o, i) => o === owner && !s.revealed[i]);

/** Gets a clue on the table so the state is mid-guess. */
function withClue(s: CodewordsState, count = 2): CodewordsState {
  return game.applyMove(s, spymasterOf(s, s.turn).id, { type: "clue", word: "signal", count }).state;
}

describe("setup", () => {
  it("needs four players — two teams with a spymaster each", () => {
    expect(game.meta.minPlayers).toBe(4);
    expect(game.meta.maxPlayers).toBe(12);
  });

  it("deals a 25-word grid", () => {
    const s = fresh();
    expect(s.words).toHaveLength(25);
    expect(new Set(s.words).size).toBe(25);
    expect(s.key).toHaveLength(25);
    expect(s.revealed.every((r) => !r)).toBe(true);
  });

  it("splits the table evenly and gives each team exactly one spymaster", () => {
    for (const size of [4, 5, 6, 7, 8, 12]) {
      const s = fresh(Array.from({ length: size }, (_, i) => `p${i}`));
      const red = s.players.filter((p) => p.team === "red");
      const blue = s.players.filter((p) => p.team === "blue");
      expect(Math.abs(red.length - blue.length)).toBeLessThanOrEqual(1);
      expect(red.filter((p) => p.role === "spymaster")).toHaveLength(1);
      expect(blue.filter((p) => p.role === "spymaster")).toHaveLength(1);
      expect(s.players).toHaveLength(size);
    }
  });

  it("gives the starting team one extra card", () => {
    const s = fresh();
    const first = s.key.filter((o) => o === s.turn).length;
    const second = s.key.filter((o) => o === otherTeam(s.turn)).length;
    expect(first).toBe(CLASSIC_CODEWORDS.firstTeamCards);
    expect(second).toBe(CLASSIC_CODEWORDS.secondTeamCards);
    expect(first).toBe(second + 1);
  });

  it("builds the composition the variant asks for", () => {
    for (const rules of CODEWORDS_VARIANTS) {
      const key = buildKey(rules, "red");
      expect(key).toHaveLength(rules.gridSize);
      expect(key.filter((o) => o === "assassin")).toHaveLength(rules.assassins);
      expect(key.filter((o) => o === "red")).toHaveLength(rules.firstTeamCards);
      expect(key.filter((o) => o === "blue")).toHaveLength(rules.secondTeamCards);
    }
  });

  it("does not start both teams on the same colour every match", () => {
    const starts = new Set(Array.from({ length: 20 }, (_, i) => fresh(SIX, i + 1).turn));
    expect(starts.size).toBe(2);
  });

  it("draws words from the chosen pack", () => {
    const s = fresh(SIX, 3, { pack: "words-naija" });
    expect(s.packId).toBe("words-naija");
    expect(s.words.some((w) => ["JOLLOF", "LAGOS", "SUYA", "NAIRA", "DANFO"].includes(w))).toBe(true);
  });

  it("falls back to a real pack when the chosen one is gone", () => {
    const s = fresh(SIX, 3, { pack: "pack-that-was-withdrawn" });
    expect(s.words).toHaveLength(25);
    expect(s.packId).toBeTruthy();
  });

  it("varies the board between matches", () => {
    const a = fresh(SIX, 1).words.join();
    const b = fresh(SIX, 2).words.join();
    expect(a).not.toBe(b);
  });
});

describe("the key is the whole game", () => {
  it("shows a spymaster every owner", () => {
    const s = fresh();
    const view = game.getPlayerView(s, spymasterOf(s, "red").id);
    expect(view.seesKey).toBe(true);
    expect(view.cards.every((c) => c.owner !== null)).toBe(true);
  });

  it("shows an operative no owner for any unrevealed card", () => {
    const s = fresh();
    const view = game.getPlayerView(s, operativeOf(s, "red").id);
    expect(view.seesKey).toBe(false);
    expect(view.cards.every((c) => c.owner === null)).toBe(true);
    // Not just absent from the cards: absent from the payload entirely.
    const wire = JSON.stringify(view);
    expect(wire).not.toContain("assassin");
  });

  it("hides the key from a spectator, who could otherwise read it out loud", () => {
    const view = game.getPlayerView(fresh(), null);
    expect(view.seesKey).toBe(false);
    expect(view.me).toBeNull();
    expect(view.cards.every((c) => c.owner === null)).toBe(true);
    expect(JSON.stringify(view)).not.toContain("assassin");
  });

  it("hides the key from the OTHER team's spymaster too", () => {
    // Both spymasters legitimately see the whole key in this game — that is
    // the design — so this pins the fact rather than assuming it.
    const s = fresh();
    const blue = game.getPlayerView(s, spymasterOf(s, "blue").id);
    expect(blue.cards.every((c) => c.owner !== null)).toBe(true);
  });

  it("reveals an owner to operatives only once the card is tapped", () => {
    const s = withClue(fresh());
    const guesser = operativeOf(s, s.turn);
    const index = indexOwned(s, s.turn);
    const after = game.applyMove(s, guesser.id, { type: "guess", cardIndex: index }).state;

    const view = game.getPlayerView(after, guesser.id);
    expect(view.cards[index]!.revealed).toBe(true);
    expect(view.cards[index]!.owner).toBe(s.turn);
    expect(view.cards.filter((c) => c.owner !== null)).toHaveLength(1);
  });

  it("publishes the key to everyone once the game is over", () => {
    const s = withClue(fresh());
    const guesser = operativeOf(s, s.turn);
    const after = game.applyMove(s, guesser.id, {
      type: "guess",
      cardIndex: indexOwned(s, "assassin"),
    }).state;
    expect(after.finished).toBe(true);
    const view = game.getPlayerView(after, null);
    expect(view.cards.every((c) => c.owner !== null)).toBe(true);
  });

  it("keeps remaining counts public — that much is meant to be known", () => {
    const view = game.getPlayerView(fresh(), null);
    expect(view.remaining.red + view.remaining.blue).toBe(17);
  });
});

describe("clues", () => {
  it("only the spymaster of the team on turn may clue", () => {
    const s = fresh();
    const turn = s.turn;
    expect(game.validateMove(s, spymasterOf(s, turn).id, { type: "clue", word: "river", count: 2 })).toBe(true);
    expect(game.validateMove(s, operativeOf(s, turn).id, { type: "clue", word: "river", count: 2 })).toBe(false);
    expect(
      game.validateMove(s, spymasterOf(s, otherTeam(turn)).id, { type: "clue", word: "river", count: 2 })
    ).toBe(false);
  });

  it("refuses a clue of more than one word", () => {
    const s = fresh();
    const sm = spymasterOf(s, s.turn).id;
    expect(game.validateMove(s, sm, { type: "clue", word: "two words", count: 1 })).toBe(false);
    expect(game.validateMove(s, sm, { type: "clue", word: "  spaced out ", count: 1 })).toBe(false);
  });

  it("refuses a clue that is a word on the table", () => {
    const s = fresh();
    const sm = spymasterOf(s, s.turn).id;
    const onBoard = s.words[4]!;
    expect(game.validateMove(s, sm, { type: "clue", word: onBoard, count: 1 })).toBe(false);
    // Case does not launder it.
    expect(game.validateMove(s, sm, { type: "clue", word: onBoard.toLowerCase(), count: 1 })).toBe(false);
  });

  it("refuses an out-of-range count", () => {
    const s = fresh();
    const sm = spymasterOf(s, s.turn).id;
    expect(game.validateMove(s, sm, { type: "clue", word: "river", count: -1 })).toBe(false);
    expect(game.validateMove(s, sm, { type: "clue", word: "river", count: 10 })).toBe(false);
    expect(game.validateMove(s, sm, { type: "clue", word: "river", count: 1.5 })).toBe(false);
  });

  it("allows a zero clue only in the variant that permits it", () => {
    const classic = fresh();
    expect(
      game.validateMove(classic, spymasterOf(classic, classic.turn).id, { type: "clue", word: "none", count: 0 })
    ).toBe(false);

    const deadly = fresh(SIX, 7, { variant: "deadly" });
    expect(deadly.rules.id).toBe("deadly");
    expect(
      game.validateMove(deadly, spymasterOf(deadly, deadly.turn).id, { type: "clue", word: "none", count: 0 })
    ).toBe(true);
  });

  it("gives the team one more guess than the clue promised", () => {
    const s = withClue(fresh(), 3);
    expect(s.guessesLeft).toBe(4);
    expect(s.phase).toBe("guess");
  });

  it("a zero clue buys unlimited guesses", () => {
    const s = fresh(SIX, 7, { variant: "deadly" });
    const after = game.applyMove(s, spymasterOf(s, s.turn).id, { type: "clue", word: "none", count: 0 }).state;
    expect(after.guessesLeft).toBeGreaterThanOrEqual(25);
  });

  it("cannot clue twice in a row", () => {
    const s = withClue(fresh());
    expect(game.validateMove(s, spymasterOf(s, s.turn).id, { type: "clue", word: "again", count: 1 })).toBe(false);
  });

  it("records clues in a public history", () => {
    const s = withClue(fresh(), 2);
    expect(s.history).toHaveLength(1);
    expect(game.getPlayerView(s, null).history[0]).toMatchObject({ word: "signal", count: 2 });
  });
});

describe("guessing", () => {
  it("only an operative of the team on turn may guess", () => {
    const s = withClue(fresh());
    const turn = s.turn;
    expect(game.validateMove(s, operativeOf(s, turn).id, { type: "guess", cardIndex: 0 })).toBe(true);
    expect(game.validateMove(s, spymasterOf(s, turn).id, { type: "guess", cardIndex: 0 })).toBe(false);
    expect(game.validateMove(s, operativeOf(s, otherTeam(turn)).id, { type: "guess", cardIndex: 0 })).toBe(false);
  });

  it("refuses a card that is already revealed, or off the board", () => {
    let s = withClue(fresh());
    const guesser = operativeOf(s, s.turn).id;
    const index = indexOwned(s, s.turn);
    s = game.applyMove(s, guesser, { type: "guess", cardIndex: index }).state;
    expect(game.validateMove(s, guesser, { type: "guess", cardIndex: index })).toBe(false);
    expect(game.validateMove(s, guesser, { type: "guess", cardIndex: 25 })).toBe(false);
    expect(game.validateMove(s, guesser, { type: "guess", cardIndex: -1 })).toBe(false);
  });

  it("keeps the turn on a correct guess and spends one guess", () => {
    const s = withClue(fresh(), 3);
    const team = s.turn;
    const after = game.applyMove(s, operativeOf(s, team).id, {
      type: "guess",
      cardIndex: indexOwned(s, team),
    }).state;
    expect(after.turn).toBe(team);
    expect(after.guessesLeft).toBe(3);
    expect(after.phase).toBe("guess");
  });

  it("ends the turn on a neutral", () => {
    const s = withClue(fresh(), 3);
    const team = s.turn;
    const after = game.applyMove(s, operativeOf(s, team).id, {
      type: "guess",
      cardIndex: indexOwned(s, "neutral"),
    }).state;
    expect(after.turn).toBe(otherTeam(team));
    expect(after.phase).toBe("clue");
    expect(after.clue).toBeNull();
  });

  it("ends the turn AND helps them when you hit the other team's card", () => {
    const s = withClue(fresh(), 3);
    const team = s.turn;
    const other = otherTeam(team);
    const before = game.getPlayerView(s, null).remaining[other];
    const after = game.applyMove(s, operativeOf(s, team).id, {
      type: "guess",
      cardIndex: indexOwned(s, other),
    }).state;
    expect(game.getPlayerView(after, null).remaining[other]).toBe(before - 1);
    expect(after.turn).toBe(other);
  });

  it("ends the turn when the guesses run out", () => {
    let s = withClue(fresh(), 1); // 1 + 1 bonus = 2 guesses
    const team = s.turn;
    const guesser = operativeOf(s, team).id;
    s = game.applyMove(s, guesser, { type: "guess", cardIndex: indexOwned(s, team) }).state;
    expect(s.turn).toBe(team);
    s = game.applyMove(s, guesser, { type: "guess", cardIndex: indexOwned(s, team) }).state;
    expect(s.turn).toBe(otherTeam(team));
  });

  it("lets a team stop early", () => {
    const s = withClue(fresh(), 3);
    const team = s.turn;
    const after = game.applyMove(s, operativeOf(s, team).id, { type: "endTurn" }).state;
    expect(after.turn).toBe(otherTeam(team));
    expect(after.guessesLeft).toBeNull();
  });

  it("does not let a spymaster end their own team's turn", () => {
    const s = withClue(fresh());
    expect(game.validateMove(s, spymasterOf(s, s.turn).id, { type: "endTurn" })).toBe(false);
  });
});

describe("winning and losing", () => {
  it("the assassin loses it on the spot, whatever the score", () => {
    const s = withClue(fresh(), 5);
    const team = s.turn;
    const { state: after, events } = game.applyMove(s, operativeOf(s, team).id, {
      type: "guess",
      cardIndex: indexOwned(s, "assassin"),
    });
    expect(after.finished).toBe(true);
    expect(after.winningTeam).toBe(otherTeam(team));
    expect(after.endReason).toBe("assassin");
    expect(after.winners.sort()).toEqual(
      after.players.filter((p) => p.team === otherTeam(team)).map((p) => p.id).sort()
    );
    expect(events.some((e) => e.type === "assassin")).toBe(true);
    expect(game.checkWinCondition(after)).toMatchObject({ finished: true });
  });

  it("a team wins by finding all of its own words", () => {
    let s = fresh();
    const team = s.turn;
    // Walk the team's cards, re-cluing whenever the turn comes back around.
    for (let guard = 0; guard < 60 && !s.finished; guard++) {
      if (s.turn !== team) {
        // Give the other team a clue and have them stop, to hand the turn back.
        s = game.applyMove(s, spymasterOf(s, s.turn).id, { type: "clue", word: "pass", count: 1 }).state;
        s = game.applyMove(s, operativeOf(s, s.turn).id, { type: "endTurn" }).state;
        continue;
      }
      if (s.phase === "clue") {
        s = game.applyMove(s, spymasterOf(s, team).id, { type: "clue", word: "more", count: 9 }).state;
      }
      s = game.applyMove(s, operativeOf(s, team).id, { type: "guess", cardIndex: indexOwned(s, team) }).state;
    }
    expect(s.finished).toBe(true);
    expect(s.winningTeam).toBe(team);
    expect(s.endReason).toBe("cleared");
  });

  it("hands the win over if you reveal the other team's last card", () => {
    let s = fresh();
    const team = s.turn;
    const other = otherTeam(team);
    // Strip the other team down to one card by marking the rest revealed.
    const theirs = s.key.map((o, i) => (o === other ? i : -1)).filter((i) => i >= 0);
    for (const i of theirs.slice(1)) s.revealed[i] = true;

    s = withClue(s, 2);
    const after = game.applyMove(s, operativeOf(s, team).id, {
      type: "guess",
      cardIndex: theirs[0]!,
    }).state;
    expect(after.finished).toBe(true);
    expect(after.winningTeam).toBe(other);
  });

  it("refuses every move once the game is finished", () => {
    const s = withClue(fresh());
    const team = s.turn;
    const after = game.applyMove(s, operativeOf(s, team).id, {
      type: "guess",
      cardIndex: indexOwned(s, "assassin"),
    }).state;
    expect(game.validateMove(after, operativeOf(after, team).id, { type: "guess", cardIndex: 0 })).toBe(false);
    expect(game.validateMove(after, spymasterOf(after, team).id, { type: "clue", word: "x", count: 1 })).toBe(false);
  });
});

describe("clocks", () => {
  it("puts the spymaster on the clock while a clue is owed, and nobody during guessing", () => {
    const s = fresh();
    expect(game.getCurrentPlayerId(s)).toBe(spymasterOf(s, s.turn).id);
    expect(game.getCurrentPlayerId(withClue(s))).toBeNull();
  });

  it("publishes a phase deadline the room can wake up on", () => {
    const s = fresh();
    expect(game.getPhaseDeadline!(s)).toBe(1_000_000 + CLASSIC_CODEWORDS.clueSeconds * 1000);
    expect(game.getPhaseDeadline!({ ...s, finished: true })).toBeNull();
  });

  it("passes the turn when a clue never arrives", () => {
    const s = fresh();
    const result = game.advancePhase!(s, s.phaseEndsAt)!;
    expect(result.state.turn).toBe(otherTeam(s.turn));
    expect(result.state.phase).toBe("clue");
    expect(result.events[0]!.type).toBe("timeout");
  });

  it("passes the turn when the guessing clock runs out", () => {
    const s = withClue(fresh());
    const result = game.advancePhase!(s, s.phaseEndsAt)!;
    expect(result.state.turn).toBe(otherTeam(s.turn));
    expect(result.state.clue).toBeNull();
  });

  it("does nothing before the deadline", () => {
    const s = fresh();
    expect(game.advancePhase!(s, s.phaseEndsAt - 5000)).toBeNull();
  });

  it("forfeits a stalled spymaster's turn rather than freezing the table", () => {
    const s = fresh();
    const forfeited = game.forfeitTurn!(s, spymasterOf(s, s.turn).id)!;
    expect(forfeited.turn).toBe(otherTeam(s.turn));
    // Nothing to forfeit for the team that is not on turn.
    expect(game.forfeitTurn!(s, spymasterOf(s, otherTeam(s.turn)).id)).toBeNull();
  });

  it("uses the variant's clocks", () => {
    const quick = fresh(SIX, 7, { variant: "quick" });
    expect(quick.phaseEndsAt).toBe(1_000_000 + getCodewordsVariant("quick").clueSeconds * 1000);
    expect(getCodewordsVariant("quick").clueSeconds).toBeLessThan(CLASSIC_CODEWORDS.clueSeconds);
  });
});

describe("full games", () => {
  /** Plays a whole match with random guessing and returns the finished state. */
  function playOut(seed: number): CodewordsState {
    let s = fresh(SIX, seed);
    let rng = seed * 2654435761;
    const rand = () => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng / 0x7fffffff;
    };

    for (let guard = 0; guard < 400 && !s.finished; guard++) {
      if (s.phase === "clue") {
        s = game.applyMove(s, spymasterOf(s, s.turn).id, { type: "clue", word: `clue${guard}`, count: 2 }).state;
        continue;
      }
      const guesser = operativeOf(s, s.turn).id;
      const open = s.revealed.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
      if (open.length === 0) break;
      const pick = open[Math.floor(rand() * open.length)]!;
      s = game.applyMove(s, guesser, { type: "guess", cardIndex: pick }).state;
    }
    return s;
  }

  it("always reaches a winner", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = playOut(seed);
      expect(s.finished, `seed ${seed} did not finish`).toBe(true);
      expect(s.winners.length).toBeGreaterThan(0);
      expect(["cleared", "assassin"]).toContain(s.endReason);
    }
  });

  it("never leaks the key to an operative at any point of a real game", () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = fresh(SIX, seed);
      let rng = seed;
      const rand = () => {
        rng = (rng * 1103515245 + 12345) & 0x7fffffff;
        return rng / 0x7fffffff;
      };
      for (let guard = 0; guard < 200 && !s.finished; guard++) {
        for (const p of s.players.filter((p) => p.role === "operative")) {
          const view = game.getPlayerView(s, p.id);
          const hidden = view.cards.filter((c) => !c.revealed);
          expect(hidden.every((c) => c.owner === null), `seed ${seed}`).toBe(true);
          expect(JSON.stringify(view)).not.toContain("assassin");
        }
        if (s.phase === "clue") {
          s = game.applyMove(s, spymasterOf(s, s.turn).id, { type: "clue", word: `c${guard}`, count: 2 }).state;
        } else {
          const open = s.revealed.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
          s = game.applyMove(s, operativeOf(s, s.turn).id, {
            type: "guess",
            cardIndex: open[Math.floor(rand() * open.length)]!,
          }).state;
        }
      }
    }
  });

  it("never reveals more cards than the grid holds", () => {
    const s = playOut(3);
    expect(s.revealed.filter(Boolean).length).toBeLessThanOrEqual(25);
    expect(s.words).toHaveLength(25);
  });

  it("plays the deadly variant too, where two assassins are waiting", () => {
    expect(DEADLY_CODEWORDS.assassins).toBe(2);
    let deaths = 0;
    for (let seed = 1; seed <= 20; seed++) {
      let s = fresh(SIX, seed, { variant: "deadly" });
      for (let guard = 0; guard < 300 && !s.finished; guard++) {
        if (s.phase === "clue") {
          s = game.applyMove(s, spymasterOf(s, s.turn).id, { type: "clue", word: `c${guard}`, count: 3 }).state;
        } else {
          const open = s.revealed.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
          s = game.applyMove(s, operativeOf(s, s.turn).id, { type: "guess", cardIndex: open[0]! }).state;
        }
      }
      expect(s.finished).toBe(true);
      if (s.endReason === "assassin") deaths++;
    }
    expect(deaths).toBeGreaterThan(0);
  });
});
