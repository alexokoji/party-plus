/**
 * Werewolf role sets and phase timings.
 *
 * Roles and timings are configuration, not code: a room picks a set and the
 * phase machine reads it. Adding a role means adding it here plus a night
 * action in the module.
 */

export type RoleId = "villager" | "werewolf" | "seer" | "doctor" | "hunter" | "witch";

export type Team = "village" | "wolves";

export interface RoleSpec {
  id: RoleId;
  name: string;
  team: Team;
  description: string;
  /** Acts during the night phase. */
  actsAtNight: boolean;
  /** Sees the identity of their fellow role-holders (wolves do). */
  knowsAllies: boolean;
}

export const ROLES: Record<RoleId, RoleSpec> = {
  villager: {
    id: "villager",
    name: "Villager",
    team: "village",
    description: "No powers. Argue well and vote wisely.",
    actsAtNight: false,
    knowsAllies: false,
  },
  werewolf: {
    id: "werewolf",
    name: "Werewolf",
    team: "wolves",
    description: "Each night, the wolves agree on someone to eat.",
    actsAtNight: true,
    knowsAllies: true,
  },
  seer: {
    id: "seer",
    name: "Seer",
    team: "village",
    description: "Each night, learn whether one player is a werewolf.",
    actsAtNight: true,
    knowsAllies: false,
  },
  doctor: {
    id: "doctor",
    name: "Doctor",
    team: "village",
    description: "Each night, protect one player from the wolves.",
    actsAtNight: true,
    knowsAllies: false,
  },
  hunter: {
    id: "hunter",
    name: "Hunter",
    team: "village",
    description: "When killed, takes someone down with them.",
    actsAtNight: false,
    knowsAllies: false,
  },
  witch: {
    id: "witch",
    name: "Witch",
    team: "village",
    description: "Holds one healing potion and one poison, each usable once.",
    actsAtNight: true,
    knowsAllies: false,
  },
};

export interface WerewolfRules {
  id: string;
  name: string;
  description: string;
  /** Seconds the night lasts before unacted roles are skipped. */
  nightSeconds: number;
  /** Seconds of open discussion before voting opens. */
  daySeconds: number;
  /** Seconds to cast a vote. */
  voteSeconds: number;
  /** Roles included, beyond the villagers who fill the remaining seats. */
  roles: RoleId[];
  /** One werewolf per this many players, rounded down, at least one. */
  playersPerWolf: number;
  /** A tied vote eliminates nobody, rather than picking at random. */
  tieMeansNoLynch: boolean;
}

export const CLASSIC_WEREWOLF: WerewolfRules = {
  id: "classic",
  name: "Classic",
  description: "Werewolves, a Seer and a Doctor. Ties spare everyone.",
  nightSeconds: 45,
  daySeconds: 120,
  voteSeconds: 45,
  roles: ["seer", "doctor"],
  playersPerWolf: 4,
  tieMeansNoLynch: true,
};

export const QUICK_WEREWOLF: WerewolfRules = {
  ...CLASSIC_WEREWOLF,
  id: "quick",
  name: "Quick",
  description: "Same roles, half the talking. Good for a short session.",
  nightSeconds: 25,
  daySeconds: 60,
  voteSeconds: 25,
};

export const CHAOS_WEREWOLF: WerewolfRules = {
  ...CLASSIC_WEREWOLF,
  id: "chaos",
  name: "Chaos",
  description: "Adds a Hunter and a Witch, and more wolves. Trust nobody.",
  roles: ["seer", "doctor", "hunter", "witch"],
  playersPerWolf: 3,
  tieMeansNoLynch: false,
};

export const WEREWOLF_VARIANTS: WerewolfRules[] = [CLASSIC_WEREWOLF, QUICK_WEREWOLF, CHAOS_WEREWOLF];

export function getWerewolfVariant(id: string | undefined): WerewolfRules {
  return WEREWOLF_VARIANTS.find((v) => v.id === id) ?? CLASSIC_WEREWOLF;
}

/** How many wolves a game of this size gets. */
export function wolfCount(players: number, rules: WerewolfRules): number {
  return Math.max(1, Math.floor(players / rules.playersPerWolf));
}
