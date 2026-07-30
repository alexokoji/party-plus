import { registerPacks } from "./store";

/**
 * Loading content from a data store, so content can change without a deploy.
 *
 * Two sources, tried in order and both optional:
 *
 *   CONTENT (KV namespace) — key "packs" holding a JSON array of packs, or an
 *     index key "packs:index" listing ids, each stored under "pack:<id>".
 *   CONTENT_URL (string)   — an HTTP endpoint returning the same JSON array.
 *
 * With neither configured the bundled packs stand alone and everything still
 * works, which is what keeps local development and tests simple.
 *
 * Failures here are deliberately non-fatal. A content store that is down or
 * serving nonsense must not stop people playing with the packs they already
 * have — it degrades to the bundled set and reports what went wrong.
 */

export interface ContentEnv {
  CONTENT?: {
    get(key: string, type: "json"): Promise<unknown>;
    get(key: string, type: "text"): Promise<string | null>;
  };
  CONTENT_URL?: string;
}

export interface HydrateResult {
  source: "kv" | "http" | "none";
  loaded: string[];
  errors: string[];
}

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

async function fromKv(env: ContentEnv): Promise<unknown[] | null> {
  const kv = env.CONTENT;
  if (!kv) return null;

  const direct = await kv.get("packs", "json").catch(() => null);
  if (isArray(direct)) return direct;

  // Index form: one key per pack, so a single pack can be edited on its own.
  const index = await kv.get("packs:index", "json").catch(() => null);
  if (!isArray(index)) return null;
  const packs: unknown[] = [];
  for (const id of index) {
    if (typeof id !== "string") continue;
    const pack = await kv.get(`pack:${id}`, "json").catch(() => null);
    if (pack) packs.push(pack);
  }
  return packs.length ? packs : null;
}

async function fromHttp(env: ContentEnv): Promise<unknown[] | null> {
  if (!env.CONTENT_URL) return null;
  const res = await fetch(env.CONTENT_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`content endpoint returned ${res.status}`);
  const body = await res.json();
  return isArray(body) ? body : null;
}

/**
 * Pulls packs from whichever source is configured and merges them in.
 *
 * Safe to call repeatedly: registering a pack replaces the previous one with
 * the same id, which is exactly how a moderation fix propagates.
 */
export async function hydratePacks(env: ContentEnv): Promise<HydrateResult> {
  const errors: string[] = [];

  for (const [source, load] of [
    ["kv", fromKv],
    ["http", fromHttp],
  ] as const) {
    try {
      const raw = await load(env);
      if (!raw) continue;
      const result = registerPacks(raw);
      return { source, loaded: result.loaded, errors: result.errors };
    } catch (e) {
      errors.push(`${source}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { source: "none", loaded: [], errors };
}

/**
 * Hydrates at most once every `ttlMs`, for callers on a hot path.
 *
 * The room DO calls this when a match starts rather than on every message: new
 * content matters at deal time, and nowhere else.
 */
export function createPackHydrator(env: ContentEnv, ttlMs = 60_000) {
  let last = 0;
  let inFlight: Promise<HydrateResult> | null = null;

  return async function hydrateIfStale(now = Date.now()): Promise<HydrateResult | null> {
    if (inFlight) return inFlight;
    if (now - last < ttlMs) return null;
    last = now;
    inFlight = hydratePacks(env).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
