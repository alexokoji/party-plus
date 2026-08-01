import { nextRandom } from "../../engine/rng";
import type { ApplyResult, GameEvent, GameModule, GameOptions, WinCondition } from "../../platform/types";
import {
  getWerewolfVariant,
  ROLES,
  WEREWOLF_VARIANTS,
  wolfCount,
  type RoleId,
  type Team,
  type WerewolfRules,
} from "./rules";

/**
 * Werewolf / Mafia.
 *
 * Roles are the hidden state, and the redaction is stricter than a card game's:
 * a player learns their own role, wolves learn each other, the seer learns what
 * they have checked — and nobody else's role is ever sent, *including to the
 * dead*. Eliminated players become spectators of the public game only, because
 * a ghost who can read every role would leak the whole game to the living the
 * moment they talk.
 *
 * The phase machine lives here. The room engine only asks when the next
 * deadline is (getPhaseDeadline) and tells the module to advance (advancePhase).
 */

export type Phase = "night" | "day" | "vote" | "over";

export type WerewolfMove =
  | { type: "nightAction"; targetId: string }
  | { type: "accuse"; targetId: string }
  | { type: "vote"; targetId: string | null }
  | { type: "ready" };

export interface WerewolfPlayerState {
  id: string;
  role: RoleId;
  alive: boolean;
  /** Night target chosen this phase, if their role acts. */
  nightChoice: string | null;
  /** Vote cast this round; null means an explicit abstention. */
  vote: string | null | undefined;
  /** Seer results: target id → was a wolf. */
  seerKnowledge: Record<string, boolean>;
  /** Witch consumables. */
  potions: { heal: boolean; poison: boolean };
}

export interface RoundSummary {
  round: number;
  killedAtNight: string[];
  savedAtNight: string[];
  lynched: string | null;
  voteTally: Record<string, number>;
}

export interface WerewolfState {
  rules: WerewolfRules;
  players: WerewolfPlayerState[];
  phase: Phase;
  round: number;
  /** Epoch ms the current phase ends. */
  phaseEndsAt: number;
  /** Public accusations during the day, for the UI. */
  accusations: Record<string, string>;
  history: RoundSummary[];
  finished: boolean;
  winners: string[];
  winningTeam: Team | null;
  rngState: number;
}

export interface WerewolfSelfView {
  role: RoleId;
  roleName: string;
  team: Team;
  description: string;
  alive: boolean;
  /** Fellow wolves, for wolves only. */
  allies: string[];
  /** Seer results so far. */
  knowledge: Array<{ playerId: string; isWolf: boolean }>;
  potions: { heal: boolean; poison: boolean } | null;
  /** Target chosen this night, if any. */
  nightChoice: string | null;
  /** Vote cast this round, if any. */
  vote: string | null | undefined;
}

export interface WerewolfPlayerView {
  rulesId: string;
  rulesName: string;
  phase: Phase;
  round: number;
  phaseEndsAt: number;
  /** Public state only: who is alive, and nothing about their role. */
  players: Array<{ id: string; alive: boolean; accusedBy: string[]; hasVoted: boolean }>;
  /** Everything this recipient knows about themselves. Null for spectators. */
  me: WerewolfSelfView | null;
  /** Whether this recipient may act right now. */
  canAct: boolean;
  /** Legal targets for the current action. */
  targets: string[];
  history: RoundSummary[];
  finished: boolean;
  winners: string[];
  winningTeam: Team | null;
  /** Roles are only ever published once the game is over. */
  revealedRoles: Record<string, RoleId> | null;
  /** The role list in play, so players know what to expect. */
  rolesInPlay: RoleId[];
}

const alivePlayers = (state: WerewolfState) => state.players.filter((p) => p.alive);
const playerOf = (state: WerewolfState, id: string) => state.players.find((p) => p.id === id) ?? null;
const teamOf = (player: WerewolfPlayerState): Team => ROLES[player.role].team;
const aliveWolves = (state: WerewolfState) => alivePlayers(state).filter((p) => teamOf(p) === "wolves");
const aliveVillagers = (state: WerewolfState) => alivePlayers(state).filter((p) => teamOf(p) === "village");

const isType = (move: unknown, type: string): boolean =>
  typeof move === "object" && move !== null && (move as { type?: unknown }).type === type;

function targetOf(move: unknown): string | null | undefined {
  if (typeof move !== "object" || move === null) return undefined;
  const t = (move as { targetId?: unknown }).targetId;
  if (t === null) return null;
  return typeof t === "string" ? t : undefined;
}

/** Deals roles: wolves first, then the configured specials, then villagers. */
function dealRoles(players: string[], rules: WerewolfRules, rngState: number) {
  const wolves = wolfCount(players.length, rules);
  const deck: RoleId[] = [
    ...Array.from({ length: wolves }, () => "werewolf" as RoleId),
    ...rules.roles,
  ];
  while (deck.length < players.length) deck.push("villager");
  deck.length = players.length;

  // Shuffle so seat order says nothing about role.
  let state = rngState;
  for (let i = deck.length - 1; i > 0; i--) {
    const next = nextRandom(state);
    state = next.state;
    const j = Math.floor(next.value * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }

  return { deck, rngState: state };
}

function beginPhase(state: WerewolfState, phase: Phase, now: number): void {
  state.phase = phase;
  const seconds =
    phase === "night"
      ? state.rules.nightSeconds
      : phase === "day"
      ? state.rules.daySeconds
      : state.rules.voteSeconds;
  state.phaseEndsAt = now + seconds * 1000;

  if (phase === "night") {
    for (const p of state.players) p.nightChoice = null;
  }
  if (phase === "vote") {
    for (const p of state.players) p.vote = undefined;
  }
  if (phase === "day") {
    state.accusations = {};
  }
}

/** Checks the win conditions and settles the game if either has been met. */
function settle(state: WerewolfState, events: GameEvent[], now: number): boolean {
  const wolves = aliveWolves(state).length;
  const villagers = aliveVillagers(state).length;

  if (wolves === 0) {
    state.finished = true;
    state.phase = "over";
    state.winningTeam = "village";
    state.winners = state.players.filter((p) => teamOf(p) === "village").map((p) => p.id);
    events.push({ type: "gameOver", text: "every werewolf is dead — the village survives" });
    return true;
  }
  if (wolves >= villagers) {
    state.finished = true;
    state.phase = "over";
    state.winningTeam = "wolves";
    state.winners = state.players.filter((p) => teamOf(p) === "wolves").map((p) => p.id);
    events.push({ type: "gameOver", text: "the wolves match the villagers — the village falls" });
    return true;
  }
  void now;
  return false;
}

/** Resolves the night: wolf kill, doctor save, witch potions, seer checks. */
function resolveNight(state: WerewolfState, events: GameEvent[], now: number): void {
  const summary: RoundSummary = {
    round: state.round,
    killedAtNight: [],
    savedAtNight: [],
    lynched: null,
    voteTally: {},
  };

  // Wolves: the most-voted target among living wolves.
  const wolfVotes = new Map<string, number>();
  for (const wolf of aliveWolves(state)) {
    if (wolf.nightChoice) wolfVotes.set(wolf.nightChoice, (wolfVotes.get(wolf.nightChoice) ?? 0) + 1);
  }
  let wolfTarget: string | null = null;
  let best = 0;
  for (const [id, count] of wolfVotes) {
    if (count > best) {
      best = count;
      wolfTarget = id;
    }
  }

  /**
   * Silent wolves still eat.
   *
   * If no wolf chose — they timed out, or went quiet deliberately — the pack
   * takes someone at random. Without this a table where nobody acts loops
   * night → day → vote → night forever with no deaths and no way to end, and
   * the room's phase clock spins on it indefinitely. Going hungry must not be
   * a viable stalling tactic.
   */
  if (wolfTarget === null) {
    const prey = alivePlayers(state).filter((p) => teamOf(p) !== "wolves");
    if (prey.length > 0) {
      const next = nextRandom(state.rngState);
      state.rngState = next.state;
      wolfTarget = prey[Math.floor(next.value * prey.length)]!.id;
      events.push({ type: "hungry", text: "the wolves went hungry — instinct chose for them" });
    }
  }

  const protectedIds = new Set(
    alivePlayers(state)
      .filter((p) => p.role === "doctor" && p.nightChoice)
      .map((p) => p.nightChoice!)
  );

  // Seer learns about their target.
  for (const seer of alivePlayers(state).filter((p) => p.role === "seer")) {
    if (!seer.nightChoice) continue;
    const target = playerOf(state, seer.nightChoice);
    if (target) seer.seerKnowledge[target.id] = teamOf(target) === "wolves";
  }

  if (wolfTarget) {
    if (protectedIds.has(wolfTarget)) {
      summary.savedAtNight.push(wolfTarget);
      events.push({ type: "saved", text: "the wolves' target survived the night" });
    } else {
      const victim = playerOf(state, wolfTarget);
      if (victim?.alive) {
        victim.alive = false;
        summary.killedAtNight.push(victim.id);
        events.push({ type: "killed", playerId: victim.id, text: "was killed in the night" });
      }
    }
  } else {
    events.push({ type: "quietNight", text: "the night passed without a kill" });
  }

  state.history.push(summary);

  if (settle(state, events, now)) return;
  state.round += 1;
  beginPhase(state, "day", now);
  events.push({ type: "phase", text: `day ${state.round} — discuss`, data: { phase: "day" } });
}

/** Resolves the vote and lynches whoever the village chose. */
function resolveVote(state: WerewolfState, events: GameEvent[], now: number): void {
  const tally = new Map<string, number>();
  for (const voter of alivePlayers(state)) {
    if (typeof voter.vote === "string") tally.set(voter.vote, (tally.get(voter.vote) ?? 0) + 1);
  }

  let top: string[] = [];
  let best = 0;
  for (const [id, count] of tally) {
    if (count > best) {
      best = count;
      top = [id];
    } else if (count === best) {
      top.push(id);
    }
  }

  const summary = state.history[state.history.length - 1];
  if (summary) summary.voteTally = Object.fromEntries(tally);

  let lynched: string | null = null;
  if (top.length === 1) {
    lynched = top[0]!;
  } else if (top.length > 1 && !state.rules.tieMeansNoLynch) {
    // Break the tie deterministically from the game's own generator.
    const next = nextRandom(state.rngState);
    state.rngState = next.state;
    lynched = top[Math.floor(next.value * top.length)]!;
  }

  if (lynched) {
    const victim = playerOf(state, lynched);
    if (victim?.alive) {
      victim.alive = false;
      if (summary) summary.lynched = victim.id;
      events.push({ type: "lynched", playerId: victim.id, text: "was voted out by the village" });

      // The hunter takes someone with them.
      if (victim.role === "hunter") {
        const candidates = alivePlayers(state);
        if (candidates.length > 0) {
          const next = nextRandom(state.rngState);
          state.rngState = next.state;
          const shot = candidates[Math.floor(next.value * candidates.length)]!;
          shot.alive = false;
          events.push({ type: "shot", playerId: shot.id, text: "was shot by the dying hunter" });
        }
      }
    }
  } else {
    events.push({ type: "noLynch", text: "the vote was tied — nobody was lynched" });
  }

  if (settle(state, events, now)) return;
  beginPhase(state, "night", now);
  events.push({ type: "phase", text: `night ${state.round}`, data: { phase: "night" } });
}

export const werewolfModule: GameModule<WerewolfState, WerewolfMove, WerewolfPlayerView> = {
  meta: {
    id: "werewolf",
    name: "Werewolf",
    tagline: "Hidden roles, nightly murder, and a village that argues badly.",
    minPlayers: 5,
    maxPlayers: 15,
    category: "party",
    modes: ["room"],
    hasHiddenState: true,
    estimatedMinutes: 25,
    variants: WEREWOLF_VARIANTS.map((v) => ({ id: v.id, name: v.name, description: v.description })),
    variantOptionKey: "variant",
  },

  createInitialState(players: string[], options: GameOptions = {}): WerewolfState {
    const rules = getWerewolfVariant(options.variant as string | undefined);
    const seed = typeof options.seed === "number" ? options.seed : Math.floor(Math.random() * 2 ** 31);
    const now = typeof options.now === "number" ? options.now : Date.now();
    const { deck, rngState } = dealRoles(players, rules, seed >>> 0);

    const state: WerewolfState = {
      rules,
      players: players.map((id, i) => ({
        id,
        role: deck[i]!,
        alive: true,
        nightChoice: null,
        vote: undefined,
        seerKnowledge: {},
        potions: { heal: true, poison: true },
      })),
      phase: "night",
      round: 1,
      phaseEndsAt: now + rules.nightSeconds * 1000,
      accusations: {},
      history: [],
      finished: false,
      winners: [],
      winningTeam: null,
      rngState,
    };
    return state;
  },

  validateMove(state, playerId, move): boolean {
    if (state.finished) return false;
    const actor = playerOf(state, playerId);
    if (!actor || !actor.alive) return false;

    if (isType(move, "nightAction")) {
      if (state.phase !== "night") return false;
      if (!ROLES[actor.role].actsAtNight) return false;
      const target = targetOf(move);
      if (typeof target !== "string") return false;
      const victim = playerOf(state, target);
      if (!victim?.alive) return false;
      // Wolves do not eat their own.
      if (actor.role === "werewolf" && teamOf(victim) === "wolves") return false;
      return true;
    }

    if (isType(move, "accuse")) {
      if (state.phase !== "day") return false;
      const target = targetOf(move);
      if (typeof target !== "string" || target === playerId) return false;
      return !!playerOf(state, target)?.alive;
    }

    if (isType(move, "vote")) {
      if (state.phase !== "vote") return false;
      const target = targetOf(move);
      if (target === null) return true; // abstain
      if (typeof target !== "string") return false;
      return !!playerOf(state, target)?.alive;
    }

    return false;
  },

  applyMove(state, playerId, move): ApplyResult<WerewolfState> {
    if (!this.validateMove(state, playerId, move)) throw new Error("illegal move");

    const next: WerewolfState = structuredClone(state);
    const events: GameEvent[] = [];
    const actor = playerOf(next, playerId)!;
    const now = Date.now();

    if (isType(move, "nightAction")) {
      actor.nightChoice = targetOf(move) as string;
      // Deliberately no public event naming the actor or target: that would
      // hand the village the wolves' identities.
      events.push({ type: "nightActed", text: "someone moved in the dark" });

      // Everyone who acts at night has acted: end the phase early.
      const waiting = alivePlayers(next).filter(
        (p) => ROLES[p.role].actsAtNight && p.nightChoice === null
      );
      if (waiting.length === 0) resolveNight(next, events, now);
      return { state: next, events };
    }

    if (isType(move, "accuse")) {
      next.accusations[playerId] = targetOf(move) as string;
      events.push({ type: "accuse", playerId, text: `accuses ${targetOf(move)}` });
      return { state: next, events };
    }

    // vote
    actor.vote = targetOf(move) as string | null;
    events.push({ type: "voted", playerId, text: "has voted" });
    const outstanding = alivePlayers(next).filter((p) => p.vote === undefined);
    if (outstanding.length === 0) resolveVote(next, events, now);
    return { state: next, events };
  },

  /**
   * The strictest redaction in the platform.
   *
   * A recipient learns their own role, their allies if the role grants it, and
   * their own accumulated knowledge. No other player's role is ever included —
   * not for the living, and not for the dead, because a ghost who can see every
   * role can leak the entire game by talking. Roles appear only once finished.
   */
  getPlayerView(state, playerId): WerewolfPlayerView {
    const me = playerId ? playerOf(state, playerId) : null;

    const accusedBy = (id: string) =>
      Object.entries(state.accusations)
        .filter(([, target]) => target === id)
        .map(([accuser]) => accuser);

    const canAct =
      !!me &&
      me.alive &&
      !state.finished &&
      ((state.phase === "night" && ROLES[me.role].actsAtNight && me.nightChoice === null) ||
        state.phase === "day" ||
        (state.phase === "vote" && me.vote === undefined));

    let targets: string[] = [];
    if (me?.alive && !state.finished) {
      if (state.phase === "night" && ROLES[me.role].actsAtNight) {
        targets = alivePlayers(state)
          .filter((p) => !(me.role === "werewolf" && teamOf(p) === "wolves"))
          .map((p) => p.id);
      } else if (state.phase === "day" || state.phase === "vote") {
        targets = alivePlayers(state)
          .filter((p) => state.phase === "vote" || p.id !== me.id)
          .map((p) => p.id);
      }
    }

    return {
      rulesId: state.rules.id,
      rulesName: state.rules.name,
      phase: state.phase,
      round: state.round,
      phaseEndsAt: state.phaseEndsAt,
      players: state.players.map((p) => ({
        id: p.id,
        alive: p.alive,
        accusedBy: accusedBy(p.id),
        // Whether someone has voted is public; who they voted for is not,
        // until the round resolves.
        hasVoted: state.phase === "vote" ? p.vote !== undefined : false,
      })),
      me: me
        ? {
            role: me.role,
            roleName: ROLES[me.role].name,
            team: teamOf(me),
            description: ROLES[me.role].description,
            alive: me.alive,
            allies: ROLES[me.role].knowsAllies
              ? state.players.filter((p) => p.id !== me.id && teamOf(p) === teamOf(me)).map((p) => p.id)
              : [],
            knowledge: Object.entries(me.seerKnowledge).map(([id, isWolf]) => ({
              playerId: id,
              isWolf,
            })),
            potions: me.role === "witch" ? me.potions : null,
            nightChoice: me.nightChoice,
            vote: me.vote,
          }
        : null,
      canAct,
      targets,
      history: state.history,
      finished: state.finished,
      winners: state.winners,
      winningTeam: state.winningTeam,
      revealedRoles: state.finished
        ? Object.fromEntries(state.players.map((p) => [p.id, p.role]))
        : null,
      rolesInPlay: [...new Set(state.players.map((p) => p.role))].sort(),
    };
  },

  checkWinCondition(state): WinCondition | null {
    if (!state.finished) return null;
    return { finished: true, winners: state.winners };
  },

  /**
   * Werewolf has no single "player to act" — night actions happen in parallel
   * and the day is a free-for-all — so the room engine's per-turn clock does
   * not apply. The phase deadline drives everything instead.
   */
  getCurrentPlayerId(): string | null {
    return null;
  },

  getPhaseDeadline(state): number | null {
    if (state.finished) return null;
    return state.phaseEndsAt;
  },

  advancePhase(state, now): ApplyResult<WerewolfState> | null {
    if (state.finished) return null;
    if (now < state.phaseEndsAt - 50) return null;

    const next: WerewolfState = structuredClone(state);
    const events: GameEvent[] = [];

    if (next.phase === "night") {
      // Anyone who did not act simply does nothing.
      resolveNight(next, events, now);
    } else if (next.phase === "day") {
      beginPhase(next, "vote", now);
      events.push({ type: "phase", text: "voting is open", data: { phase: "vote" } });
    } else if (next.phase === "vote") {
      resolveVote(next, events, now);
    } else {
      return null;
    }

    return { state: next, events };
  },

  getEliminatedPlayers(state): string[] {
    return state.players.filter((p) => !p.alive).map((p) => p.id);
  },
};

export { alivePlayers, aliveWolves, aliveVillagers, teamOf };
