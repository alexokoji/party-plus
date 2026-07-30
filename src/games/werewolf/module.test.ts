import { describe, it, expect } from "vitest";
import {
  aliveVillagers,
  aliveWolves,
  teamOf,
  werewolfModule as game,
  type WerewolfState,
} from "./module";
import {
  CHAOS_WEREWOLF,
  CLASSIC_WEREWOLF,
  getWerewolfVariant,
  ROLES,
  WEREWOLF_VARIANTS,
  wolfCount,
} from "./rules";

const SEVEN = ["a", "b", "c", "d", "e", "f", "g"];

function fresh(players = SEVEN, seed = 1, variant = "classic", now = 1_000_000): WerewolfState {
  return game.createInitialState(players, { seed, variant, now });
}

const wolvesOf = (s: WerewolfState) => s.players.filter((p) => teamOf(p) === "wolves");
const roleHolder = (s: WerewolfState, role: string) => s.players.find((p) => p.role === role);

describe("setup", () => {
  it("supports 5 to 15 players", () => {
    expect(game.meta.minPlayers).toBe(5);
    expect(game.meta.maxPlayers).toBe(15);
  });

  it("gives everyone exactly one role", () => {
    const state = fresh();
    expect(state.players).toHaveLength(SEVEN.length);
    for (const p of state.players) expect(ROLES[p.role]).toBeDefined();
  });

  it("scales the wolf count with the table size", () => {
    expect(wolfCount(5, CLASSIC_WEREWOLF)).toBe(1);
    expect(wolfCount(8, CLASSIC_WEREWOLF)).toBe(2);
    expect(wolfCount(12, CLASSIC_WEREWOLF)).toBe(3);
    // Chaos packs more wolves in.
    expect(wolfCount(9, CHAOS_WEREWOLF)).toBe(3);
  });

  it("deals the configured special roles", () => {
    const state = fresh();
    expect(roleHolder(state, "seer")).toBeDefined();
    expect(roleHolder(state, "doctor")).toBeDefined();
  });

  it("adds the chaos roles in that variant", () => {
    const state = fresh(SEVEN.concat(["h", "i"]), 3, "chaos");
    expect(roleHolder(state, "hunter")).toBeDefined();
    expect(roleHolder(state, "witch")).toBeDefined();
  });

  it("starts at night on round one", () => {
    const state = fresh();
    expect(state.phase).toBe("night");
    expect(state.round).toBe(1);
    expect(state.phaseEndsAt).toBe(1_000_000 + CLASSIC_WEREWOLF.nightSeconds * 1000);
  });

  it("does not put everyone on the same team", () => {
    const state = fresh();
    expect(aliveWolves(state).length).toBeGreaterThan(0);
    expect(aliveVillagers(state).length).toBeGreaterThan(0);
  });
});

describe("hidden roles — the important part", () => {
  it("tells a player their own role and nobody else's", () => {
    const state = fresh();
    for (const p of state.players) {
      const view = game.getPlayerView(state, p.id);
      expect(view.me!.role).toBe(p.role);
      // The public player list carries no role information whatsoever.
      for (const entry of view.players) {
        expect(Object.keys(entry).sort()).toEqual(["accusedBy", "alive", "hasVoted", "id"]);
      }
      expect(view.revealedRoles).toBeNull();
    }
  });

  it("never serialises another player's role while the game runs", () => {
    const state = fresh();
    const villager = state.players.find((p) => p.role === "villager")!;
    const view = game.getPlayerView(state, villager.id);
    const wire = JSON.stringify(view);

    // A plain villager must not be able to find any other role in the payload.
    for (const other of state.players) {
      if (other.id === villager.id) continue;
      expect(wire).not.toContain(`"${other.id}":"${other.role}"`);
    }
    // Only their own role name appears.
    expect(view.me!.role).toBe("villager");
  });

  it("lets wolves see each other and nobody else", () => {
    const state = fresh();
    const wolves = wolvesOf(state);
    for (const wolf of wolves) {
      const view = game.getPlayerView(state, wolf.id);
      expect(view.me!.allies.sort()).toEqual(
        wolves.filter((w) => w.id !== wolf.id).map((w) => w.id).sort()
      );
    }
  });

  it("does not let villagers see any allies", () => {
    const state = fresh();
    const villager = state.players.find((p) => p.role === "villager")!;
    expect(game.getPlayerView(state, villager.id).me!.allies).toEqual([]);
  });

  it("does not let the seer see allies either", () => {
    const state = fresh();
    const seer = roleHolder(state, "seer")!;
    expect(ROLES.seer.knowsAllies).toBe(false);
    expect(game.getPlayerView(state, seer.id).me!.allies).toEqual([]);
  });

  it("hides every role from a pure spectator", () => {
    const view = game.getPlayerView(fresh(), null);
    expect(view.me).toBeNull();
    expect(view.revealedRoles).toBeNull();
    const wire = JSON.stringify(view);
    for (const role of ["werewolf", "seer", "doctor"]) {
      expect(wire).not.toContain(`"role":"${role}"`);
    }
  });

  it("keeps roles hidden from the DEAD, who could otherwise leak the game", () => {
    const state = fresh();
    const victim = state.players[0]!;
    victim.alive = false;

    const view = game.getPlayerView(state, victim.id);
    expect(view.me!.alive).toBe(false);
    // A ghost sees their own role and the public board — never everyone's roles.
    expect(view.revealedRoles).toBeNull();
    for (const other of state.players) {
      if (other.id === victim.id) continue;
      expect(JSON.stringify(view)).not.toContain(`"${other.id}":"${other.role}"`);
    }
  });

  it("reveals every role once the game is over", () => {
    const state = fresh();
    state.finished = true;
    const view = game.getPlayerView(state, state.players[0]!.id);
    expect(Object.keys(view.revealedRoles ?? {})).toHaveLength(SEVEN.length);
  });
});

describe("night phase", () => {
  it("lets wolves pick a target but not one of their own", () => {
    const state = fresh();
    const wolf = wolvesOf(state)[0]!;
    const villager = aliveVillagers(state)[0]!;
    const otherWolf = wolvesOf(state).find((w) => w.id !== wolf.id);

    expect(game.validateMove(state, wolf.id, { type: "nightAction", targetId: villager.id })).toBe(true);
    if (otherWolf) {
      expect(game.validateMove(state, wolf.id, { type: "nightAction", targetId: otherWolf.id })).toBe(false);
    }
  });

  it("does not let a villager act at night", () => {
    const state = fresh();
    const villager = state.players.find((p) => p.role === "villager")!;
    const target = state.players.find((p) => p.id !== villager.id)!;
    expect(ROLES.villager.actsAtNight).toBe(false);
    expect(game.validateMove(state, villager.id, { type: "nightAction", targetId: target.id })).toBe(false);
  });

  it("emits no event naming the wolf or the target", () => {
    // Distinctive multi-character ids: single letters appear by chance inside
    // ordinary words ("a" is in "dark"), which made this check meaningless.
    const state = fresh(["zeta1", "zeta2", "zeta3", "zeta4", "zeta5", "zeta6", "zeta7"], 4);
    const wolf = wolvesOf(state)[0]!;
    const victim = aliveVillagers(state)[0]!;
    const { events } = game.applyMove(state, wolf.id, { type: "nightAction", targetId: victim.id });
    // A public event naming either would hand the village the wolves.
    for (const e of events) {
      expect(e.playerId).toBeUndefined();
      expect(JSON.stringify(e)).not.toContain(wolf.id);
      expect(JSON.stringify(e)).not.toContain(victim.id);
    }
  });

  it("kills the wolves' target when nobody protects them", () => {
    const state = fresh(["w", "v1", "v2", "v3", "v4"], 7);
    // Rig the roles so the test is deterministic.
    state.players = [
      { ...state.players[0]!, id: "w", role: "werewolf" },
      { ...state.players[1]!, id: "v1", role: "villager" },
      { ...state.players[2]!, id: "v2", role: "villager" },
      { ...state.players[3]!, id: "v3", role: "villager" },
      { ...state.players[4]!, id: "v4", role: "villager" },
    ];
    const { state: after } = game.applyMove(state, "w", { type: "nightAction", targetId: "v1" });
    expect(after.players.find((p) => p.id === "v1")!.alive).toBe(false);
    expect(after.phase).toBe("day");
  });

  it("lets the doctor save the wolves' target", () => {
    const state = fresh(["w", "doc", "v1", "v2", "v3"], 7);
    state.players = [
      { ...state.players[0]!, id: "w", role: "werewolf" },
      { ...state.players[1]!, id: "doc", role: "doctor" },
      { ...state.players[2]!, id: "v1", role: "villager" },
      { ...state.players[3]!, id: "v2", role: "villager" },
      { ...state.players[4]!, id: "v3", role: "villager" },
    ];
    let current = game.applyMove(state, "w", { type: "nightAction", targetId: "v1" }).state;
    current = game.applyMove(current, "doc", { type: "nightAction", targetId: "v1" }).state;
    expect(current.players.find((p) => p.id === "v1")!.alive).toBe(true);
    expect(current.history[0]!.savedAtNight).toContain("v1");
  });

  it("gives the seer a true reading, visible only to them", () => {
    const state = fresh(["w", "seer", "v1", "v2", "v3"], 7);
    state.players = [
      { ...state.players[0]!, id: "w", role: "werewolf" },
      { ...state.players[1]!, id: "seer", role: "seer" },
      { ...state.players[2]!, id: "v1", role: "villager" },
      { ...state.players[3]!, id: "v2", role: "villager" },
      { ...state.players[4]!, id: "v3", role: "villager" },
    ];
    let current = game.applyMove(state, "seer", { type: "nightAction", targetId: "w" }).state;
    current = game.applyMove(current, "w", { type: "nightAction", targetId: "v1" }).state;

    const seerView = game.getPlayerView(current, "seer");
    expect(seerView.me!.knowledge).toContainEqual({ playerId: "w", isWolf: true });
    // Nobody else learns the reading.
    const otherView = game.getPlayerView(current, "v2");
    expect(otherView.me!.knowledge).toEqual([]);
    expect(JSON.stringify(otherView)).not.toContain("isWolf");
  });
});

describe("the phase machine", () => {
  it("publishes a phase deadline for the room engine", () => {
    const state = fresh();
    expect(game.getPhaseDeadline!(state)).toBe(state.phaseEndsAt);
  });

  it("has no single player to act — the clock drives it", () => {
    expect(game.getCurrentPlayerId(fresh())).toBeNull();
  });

  it("refuses to advance before the deadline", () => {
    const state = fresh();
    expect(game.advancePhase!(state, state.phaseEndsAt - 5000)).toBeNull();
  });

  it("runs night → day → vote → night", () => {
    let state = fresh();
    expect(state.phase).toBe("night");

    state = game.advancePhase!(state, state.phaseEndsAt)!.state;
    expect(state.phase).toBe("day");

    state = game.advancePhase!(state, state.phaseEndsAt)!.state;
    expect(state.phase).toBe("vote");

    state = game.advancePhase!(state, state.phaseEndsAt)!.state;
    expect(["night", "over"]).toContain(state.phase);
  });

  it("resets the deadline on each transition", () => {
    const state = fresh();
    const advanced = game.advancePhase!(state, state.phaseEndsAt)!.state;
    expect(advanced.phaseEndsAt).toBeGreaterThan(state.phaseEndsAt);
    expect(advanced.phaseEndsAt - state.phaseEndsAt).toBeCloseTo(
      CLASSIC_WEREWOLF.daySeconds * 1000,
      -3
    );
  });

  it("ends the night early once everyone who acts has acted", () => {
    const state = fresh(["w", "seer", "doc", "v1", "v2"], 7);
    state.players = [
      { ...state.players[0]!, id: "w", role: "werewolf" },
      { ...state.players[1]!, id: "seer", role: "seer" },
      { ...state.players[2]!, id: "doc", role: "doctor" },
      { ...state.players[3]!, id: "v1", role: "villager" },
      { ...state.players[4]!, id: "v2", role: "villager" },
    ];
    let current = game.applyMove(state, "w", { type: "nightAction", targetId: "v1" }).state;
    expect(current.phase).toBe("night");
    current = game.applyMove(current, "seer", { type: "nightAction", targetId: "w" }).state;
    expect(current.phase).toBe("night");
    current = game.applyMove(current, "doc", { type: "nightAction", targetId: "v2" }).state;
    // Last night-actor done: the phase should have moved on without the timer.
    expect(current.phase).toBe("day");
  });

  it("stops scheduling once the game is over", () => {
    const state = fresh();
    state.finished = true;
    expect(game.getPhaseDeadline!(state)).toBeNull();
    expect(game.advancePhase!(state, Date.now() + 10_000)).toBeNull();
  });
});

describe("day and vote", () => {
  it("allows accusations only during the day, and not of yourself", () => {
    let state = fresh();
    const [p1, p2] = state.players;
    expect(game.validateMove(state, p1!.id, { type: "accuse", targetId: p2!.id })).toBe(false);

    state = game.advancePhase!(state, state.phaseEndsAt)!.state;
    expect(state.phase).toBe("day");
    expect(game.validateMove(state, p1!.id, { type: "accuse", targetId: p2!.id })).toBe(true);
    expect(game.validateMove(state, p1!.id, { type: "accuse", targetId: p1!.id })).toBe(false);
  });

  it("shows accusations publicly", () => {
    let state = fresh();
    state = game.advancePhase!(state, state.phaseEndsAt)!.state;
    const [p1, p2] = state.players;
    state = game.applyMove(state, p1!.id, { type: "accuse", targetId: p2!.id }).state;

    const view = game.getPlayerView(state, p2!.id);
    expect(view.players.find((p) => p.id === p2!.id)!.accusedBy).toContain(p1!.id);
  });

  it("allows votes only during the vote phase, and permits abstaining", () => {
    let state = fresh();
    state = game.advancePhase!(state, state.phaseEndsAt)!.state; // day
    const [p1, p2] = state.players;
    expect(game.validateMove(state, p1!.id, { type: "vote", targetId: p2!.id })).toBe(false);

    state = game.advancePhase!(state, state.phaseEndsAt)!.state; // vote
    expect(game.validateMove(state, p1!.id, { type: "vote", targetId: p2!.id })).toBe(true);
    expect(game.validateMove(state, p1!.id, { type: "vote", targetId: null })).toBe(true);
  });

  it("shows that someone voted but not who for", () => {
    let state = fresh();
    state = game.advancePhase!(state, state.phaseEndsAt)!.state;
    state = game.advancePhase!(state, state.phaseEndsAt)!.state;
    const [p1, p2] = state.players;
    state = game.applyMove(state, p1!.id, { type: "vote", targetId: p2!.id }).state;

    const view = game.getPlayerView(state, p2!.id);
    expect(view.players.find((p) => p.id === p1!.id)!.hasVoted).toBe(true);
    // p2 must not be able to see that p1 voted for them specifically.
    expect(JSON.stringify(view.players)).not.toContain('"vote"');
  });

  it("lynches the player with the most votes", () => {
    let state = fresh(["a", "b", "c", "d", "e"], 7);
    state = game.advancePhase!(state, state.phaseEndsAt)!.state; // day
    state = game.advancePhase!(state, state.phaseEndsAt)!.state; // vote
    for (const voter of state.players.filter((p) => p.alive)) {
      if (state.finished) break;
      state = game.applyMove(state, voter.id, { type: "vote", targetId: "a" }).state;
    }
    expect(state.players.find((p) => p.id === "a")!.alive).toBe(false);
  });

  it("spares everyone on a tie when the variant says so", () => {
    let state = fresh(["a", "b", "c", "d", "e", "f"], 5);
    expect(CLASSIC_WEREWOLF.tieMeansNoLynch).toBe(true);
    state = game.advancePhase!(state, state.phaseEndsAt)!.state;
    state = game.advancePhase!(state, state.phaseEndsAt)!.state;

    const alive = state.players.filter((p) => p.alive);
    // One vote each for two different targets and everyone else abstaining is a
    // tie regardless of how many survived the night.
    alive.forEach((voter, i) => {
      const targetId = i === 0 ? alive[1]!.id : i === 1 ? alive[0]!.id : null;
      state = game.applyMove(state, voter.id, { type: "vote", targetId }).state;
    });
    const lynched = state.history[state.history.length - 1]?.lynched;
    expect(lynched === null || lynched === undefined).toBe(true);
  });

  it("does not let the dead act", () => {
    let state = fresh();
    state = game.advancePhase!(state, state.phaseEndsAt)!.state;
    const victim = state.players[0]!;
    victim.alive = false;
    expect(game.validateMove(state, victim.id, { type: "accuse", targetId: state.players[1]!.id })).toBe(false);
  });
});

describe("winning", () => {
  it("gives it to the village when the last wolf dies", () => {
    const state = fresh(["w", "v1", "v2", "v3", "v4"], 7);
    state.players = [
      { ...state.players[0]!, id: "w", role: "werewolf" },
      { ...state.players[1]!, id: "v1", role: "villager" },
      { ...state.players[2]!, id: "v2", role: "villager" },
      { ...state.players[3]!, id: "v3", role: "villager" },
      { ...state.players[4]!, id: "v4", role: "villager" },
    ];
    state.phase = "vote";
    for (const voter of state.players) {
      if (state.finished) break;
      state.players.find((p) => p.id === voter.id)!.vote = undefined;
    }
    let current = state;
    for (const voter of current.players.filter((p) => p.alive)) {
      if (current.finished) break;
      current = game.applyMove(current, voter.id, { type: "vote", targetId: "w" }).state;
    }
    expect(current.finished).toBe(true);
    expect(current.winningTeam).toBe("village");
    expect(current.winners).toContain("v1");
    expect(current.winners).not.toContain("w");
  });

  it("gives it to the wolves once they match the villagers", () => {
    const state = fresh(["w1", "w2", "v1", "v2", "v3"], 7);
    state.players = [
      { ...state.players[0]!, id: "w1", role: "werewolf" },
      { ...state.players[1]!, id: "w2", role: "werewolf" },
      { ...state.players[2]!, id: "v1", role: "villager" },
      { ...state.players[3]!, id: "v2", role: "villager" },
      { ...state.players[4]!, id: "v3", role: "villager" },
    ];
    // One villager already gone; killing another makes it 2 wolves vs 2.
    state.players.find((p) => p.id === "v3")!.alive = false;
    // Both wolves act at night, so the night only resolves once both have.
    let after = game.applyMove(state, "w1", { type: "nightAction", targetId: "v2" }).state;
    expect(after.finished).toBe(false);
    after = game.applyMove(after, "w2", { type: "nightAction", targetId: "v2" }).state;
    expect(after.finished).toBe(true);
    expect(after.winningTeam).toBe("wolves");
    expect(after.winners.sort()).toEqual(["w1", "w2"]);
  });

  it("marks the dead as eliminated so the shell makes them spectators", () => {
    const state = fresh();
    state.players[0]!.alive = false;
    expect(game.getEliminatedPlayers!(state)).toEqual([state.players[0]!.id]);
  });
});

describe("validation", () => {
  it("rejects malformed moves without throwing", () => {
    const state = fresh();
    const wolf = wolvesOf(state)[0]!;
    for (const junk of [
      null,
      undefined,
      {},
      4,
      "vote",
      { type: "nightAction" },
      { type: "nightAction", targetId: 5 },
      { type: "nightAction", targetId: "nobody" },
      { type: "bogus", targetId: "a" },
    ]) {
      expect(() => game.validateMove(state, wolf.id, junk as never)).not.toThrow();
      expect(game.validateMove(state, wolf.id, junk as never)).toBe(false);
    }
  });

  it("does not mutate the state it is given", () => {
    const state = fresh();
    const before = JSON.stringify(state);
    const wolf = wolvesOf(state)[0]!;
    const victim = aliveVillagers(state)[0]!;
    game.applyMove(state, wolf.id, { type: "nightAction", targetId: victim.id });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("falls back to the classic variant for an unknown id", () => {
    expect(getWerewolfVariant("nope").id).toBe("classic");
    expect(new Set(WEREWOLF_VARIANTS.map((v) => v.id)).size).toBe(WEREWOLF_VARIANTS.length);
  });
});

describe("full games via the phase clock", () => {
  it("always reaches a winner", () => {
    for (let seed = 1; seed <= 15; seed++) {
      let state = fresh(SEVEN, seed);
      let guard = 0;
      while (game.checkWinCondition(state) === null) {
        if (guard++ > 400) throw new Error(`seed ${seed} did not resolve`);
        // Drive purely off the phase clock, as the room engine does.
        const advanced = game.advancePhase!(state, state.phaseEndsAt);
        if (!advanced) break;
        state = advanced.state;
      }
      const win = game.checkWinCondition(state);
      expect(win, `seed ${seed} never finished`).not.toBeNull();
      expect(win!.winners.length).toBeGreaterThan(0);
    }
  });
});
