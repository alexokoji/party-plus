/**
 * Danfo Dash: weave through Lagos traffic.
 *
 * The simulation is a pure function of state and elapsed time, kept apart from
 * the canvas so it can be tested without a browser and without waiting in real
 * time. Everything below is deterministic given a seed — which is what lets a
 * test assert that the difficulty really does climb, and that a collision is a
 * collision.
 */

export const LANES = 3;
export const LANE_WIDTH = 1 / LANES;

export interface Obstacle {
  /** 0..LANES-1 */
  lane: number;
  /** 0 at the horizon, 1 at the player. */
  y: number;
  kind: "car" | "pothole" | "keke";
}

export interface DashState {
  lane: number;
  obstacles: Obstacle[];
  /** Metres travelled, which is the score. */
  distance: number;
  speed: number;
  /** Seconds until the next spawn. */
  nextSpawn: number;
  crashed: boolean;
  rngState: number;
}

const START_SPEED = 0.55;
const MAX_SPEED = 1.9;
/** The player sits here; an obstacle within this band is on top of them. */
const PLAYER_Y = 0.86;
const HIT_BAND = 0.07;

export function createDash(seed = Date.now()): DashState {
  return {
    lane: 1,
    obstacles: [],
    distance: 0,
    speed: START_SPEED,
    nextSpawn: 0.6,
    crashed: false,
    rngState: seed >>> 0,
  };
}

/** xorshift — small, fast, and reproducible from a seed. */
function nextRandom(state: number): { value: number; state: number } {
  let x = state || 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  const next = x >>> 0;
  return { value: next / 0xffffffff, state: next };
}

export function moveLane(state: DashState, direction: -1 | 1): DashState {
  if (state.crashed) return state;
  const lane = Math.max(0, Math.min(LANES - 1, state.lane + direction));
  return lane === state.lane ? state : { ...state, lane };
}

/**
 * Advances the world by `dt` seconds.
 *
 * Obstacles move toward the player rather than the player moving forward, so
 * the maths stays in one dimension and the collision test is a band check.
 */
export function step(state: DashState, dt: number): DashState {
  if (state.crashed) return state;

  // Cap the step: a backgrounded tab returns with a huge delta, and without
  // this the player teleports through a car and "crashes" on nothing.
  const delta = Math.min(dt, 0.05);

  const speed = Math.min(MAX_SPEED, state.speed + delta * 0.035);
  let rngState = state.rngState;
  let nextSpawn = state.nextSpawn - delta;

  const obstacles = state.obstacles
    .map((o) => ({ ...o, y: o.y + delta * speed }))
    .filter((o) => o.y < 1.15);

  if (nextSpawn <= 0) {
    const laneRoll = nextRandom(rngState);
    rngState = laneRoll.state;
    const kindRoll = nextRandom(rngState);
    rngState = kindRoll.state;
    const gapRoll = nextRandom(rngState);
    rngState = gapRoll.state;

    const lane = Math.min(LANES - 1, Math.floor(laneRoll.value * LANES));
    /**
     * Never seal the road.
     *
     * Obstacles all travel at the same speed, so a set that spawns close
     * together arrives together — if that set covers every lane there is no
     * way through, and the run ends on a dice roll rather than on reflexes.
     *
     * Spawning into a lane that is ALREADY blocked costs nothing, since it
     * removes no option the player still had. Spawning into the last free one
     * is the move that has to be refused.
     */
    const blocked = new Set(obstacles.filter((o) => o.y < 0.2).map((o) => o.lane));
    const wouldSeal = !blocked.has(lane) && blocked.size >= LANES - 1;
    if (!wouldSeal) {
      obstacles.push({
        lane,
        y: -0.1,
        kind: kindRoll.value < 0.15 ? "pothole" : kindRoll.value < 0.45 ? "keke" : "car",
      });
    }
    // Spawns tighten as speed climbs, which is where the difficulty comes from.
    nextSpawn = (0.55 + gapRoll.value * 0.5) / (speed / START_SPEED);
  }

  const crashed = obstacles.some(
    (o) => o.lane === state.lane && Math.abs(o.y - PLAYER_Y) < HIT_BAND
  );

  return {
    ...state,
    speed,
    obstacles,
    nextSpawn,
    crashed,
    distance: state.distance + delta * speed * 60,
    rngState,
  };
}

export { PLAYER_Y, HIT_BAND };
