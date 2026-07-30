import type {
  ContentPack,
  DrawPack,
  PackKind,
  PackSummary,
  TriviaPack,
  TriviaQuestion,
  WordPack,
} from "./types";

/**
 * The content store.
 *
 * Bundled packs are registered at import time; extra packs can be pushed in at
 * runtime from a data store (see remote.ts), which is the whole point — adding
 * or correcting a question must not require a deploy. Everything entering the
 * store goes through validation first, because runtime content is untrusted
 * input: a malformed pack that reached a module would surface as a broken match
 * for real players, and a trivia pack whose answerIndex is out of range would
 * make a question unanswerable.
 */

const packs = new Map<string, ContentPack>();

export class PackError extends Error {}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function validateMeta(raw: any, kind: PackKind): void {
  if (!raw || typeof raw !== "object") throw new PackError("pack must be an object");
  if (!isNonEmptyString(raw.id)) throw new PackError("pack needs an id");
  if (!isNonEmptyString(raw.name)) throw new PackError(`pack ${raw.id}: needs a name`);
  if (!isNonEmptyString(raw.locale)) throw new PackError(`pack ${raw.id}: needs a locale`);
  if (raw.kind !== kind) throw new PackError(`pack ${raw.id}: expected kind ${kind}, got ${raw.kind}`);
}

/** Words are compared case-insensitively later, so reject duplicates now. */
function assertDistinct(id: string, values: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (seen.has(key)) throw new PackError(`pack ${id}: duplicate entry "${value}"`);
    seen.add(key);
  }
}

export function validatePack(raw: unknown): ContentPack {
  const any = raw as any;
  const kind = any?.kind;

  if (kind === "words") {
    validateMeta(any, "words");
    if (!Array.isArray(any.words) || !any.words.every(isNonEmptyString)) {
      throw new PackError(`pack ${any.id}: words must be non-empty strings`);
    }
    // A grid needs 25 distinct words, and a pack that can only fill one grid
    // gives every match the same board.
    if (any.words.length < 40) {
      throw new PackError(`pack ${any.id}: word packs need at least 40 words, got ${any.words.length}`);
    }
    assertDistinct(any.id, any.words);
    return { ...any, words: any.words.map((w: string) => w.trim()) } as WordPack;
  }

  if (kind === "draw") {
    validateMeta(any, "draw");
    if (!Array.isArray(any.words) || any.words.length < 20) {
      throw new PackError(`pack ${any.id}: draw packs need at least 20 words`);
    }
    for (const entry of any.words) {
      if (!isNonEmptyString(entry?.word)) throw new PackError(`pack ${any.id}: bad draw entry`);
      if (![1, 2, 3].includes(entry.difficulty)) {
        throw new PackError(`pack ${any.id}: "${entry.word}" needs difficulty 1, 2 or 3`);
      }
    }
    assertDistinct(any.id, any.words.map((w: any) => w.word));
    return any as DrawPack;
  }

  if (kind === "trivia") {
    validateMeta(any, "trivia");
    if (!Array.isArray(any.questions) || any.questions.length < 5) {
      throw new PackError(`pack ${any.id}: trivia packs need at least 5 questions`);
    }
    for (const q of any.questions as TriviaQuestion[]) {
      if (!isNonEmptyString(q?.id)) throw new PackError(`pack ${any.id}: question needs an id`);
      if (!isNonEmptyString(q.question)) throw new PackError(`pack ${any.id}: ${q.id} has no text`);
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) {
        throw new PackError(`pack ${any.id}: ${q.id} needs 2–6 options`);
      }
      if (!q.options.every(isNonEmptyString)) {
        throw new PackError(`pack ${any.id}: ${q.id} has an empty option`);
      }
      assertDistinct(`${any.id}:${q.id}`, q.options);
      if (
        typeof q.answerIndex !== "number" ||
        !Number.isInteger(q.answerIndex) ||
        q.answerIndex < 0 ||
        q.answerIndex >= q.options.length
      ) {
        throw new PackError(`pack ${any.id}: ${q.id} has an out-of-range answerIndex`);
      }
    }
    assertDistinct(any.id, (any.questions as TriviaQuestion[]).map((q) => q.id));
    return any as TriviaPack;
  }

  throw new PackError(`unknown pack kind: ${String(kind)}`);
}

/**
 * Adds a pack, replacing any pack with the same id.
 *
 * Replacement is deliberate: that is how a correction pushed from the data
 * store takes effect on a running Worker.
 */
export function registerPack(raw: unknown): ContentPack {
  const pack = validatePack(raw);
  packs.set(pack.id, pack);
  return pack;
}

/** Loads many packs, returning what failed rather than throwing the batch away. */
export function registerPacks(raws: unknown[]): { loaded: string[]; errors: string[] } {
  const loaded: string[] = [];
  const errors: string[] = [];
  for (const raw of raws) {
    try {
      loaded.push(registerPack(raw).id);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { loaded, errors };
}

export function getPack(id: string): ContentPack | null {
  return packs.get(id) ?? null;
}

function ofKind<T extends ContentPack>(kind: PackKind): T[] {
  return [...packs.values()].filter((p) => p.kind === kind) as T[];
}

export function getWordPack(id: string): WordPack | null {
  const pack = packs.get(id);
  return pack?.kind === "words" ? pack : null;
}

export function getDrawPack(id: string): DrawPack | null {
  const pack = packs.get(id);
  return pack?.kind === "draw" ? pack : null;
}

export function getTriviaPack(id: string): TriviaPack | null {
  const pack = packs.get(id);
  return pack?.kind === "trivia" ? pack : null;
}

export function packSize(pack: ContentPack): number {
  return pack.kind === "trivia" ? pack.questions.length : pack.words.length;
}

/** Pack list for a lobby picker: metadata and sizes, never the content. */
export function listPacks(kind: PackKind): PackSummary[] {
  return ofKind(kind)
    .filter((p) => !p.hidden)
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      locale: p.locale,
      kind: p.kind,
      size: packSize(p),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolves a requested pack id, falling back to any pack of the right kind.
 *
 * A room whose chosen pack has been withdrawn from the data store must still be
 * able to start a match rather than failing at deal time.
 */
export function resolvePack<T extends ContentPack>(kind: PackKind, id: string | undefined): T {
  const requested = id ? packs.get(id) : null;
  if (requested?.kind === kind) return requested as T;
  const fallback = ofKind<T>(kind)[0];
  if (!fallback) throw new PackError(`no ${kind} packs are loaded`);
  return fallback;
}

/** Test seam. */
export function clearPacks(): void {
  packs.clear();
}
