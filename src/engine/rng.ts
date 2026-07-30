/** Deterministic PRNG (mulberry32) so matches are reproducible from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: () => number, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

/**
 * One step of the same generator, as a pure function of its state.
 *
 * Needed where the generator has to survive serialisation — a Durable Object
 * persists game state between moves, so it cannot hold a closure. Callers keep
 * the returned `state` and pass it back for the next draw.
 *
 * Use this rather than re-seeding mulberry32 per draw: its *first* output for
 * nearby seeds is strongly correlated, so `mulberry32(seed + n * k)()` produces
 * a badly clustered sequence. Advancing one stream avoids that entirely.
 */
export function nextRandom(state: number): { value: number; state: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a };
}

/** Rolls a die from a serialisable generator state. */
export function rollDie(state: number, sides = 6): { value: number; state: number } {
  const next = nextRandom(state);
  return { value: 1 + Math.floor(next.value * sides), state: next.state };
}
