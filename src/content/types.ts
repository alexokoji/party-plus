/**
 * Content packs: the words and questions games draw from.
 *
 * Content is deliberately NOT part of any game module. Word lists and question
 * banks need to be added, corrected and moderated far more often than rules
 * change, and shipping a new question should never mean redeploying the
 * Worker. Modules ask the store for a pack by id; where that pack came from —
 * bundled JSON, KV, an HTTP endpoint — is not their business.
 */

export type PackKind = "words" | "draw" | "trivia";

export interface PackMeta {
  id: string;
  name: string;
  description: string;
  /** BCP-47-ish tag, for display and filtering: "en", "en-NG", "pcm" (pidgin). */
  locale: string;
  /** Hidden from the lobby picker, but still loadable by id. */
  hidden?: boolean;
}

/** A pack of single words/short phrases for the word-association grid. */
export interface WordPack extends PackMeta {
  kind: "words";
  words: string[];
}

/** A pack of things to draw, with a difficulty band for scoring and filtering. */
export interface DrawPack extends PackMeta {
  kind: "draw";
  words: Array<{ word: string; difficulty: 1 | 2 | 3 }>;
}

export interface TriviaQuestion {
  id: string;
  question: string;
  /** 2–6 options, shown in a stable order. */
  options: string[];
  /** Index into `options`. NEVER leaves the server. */
  answerIndex: number;
  category?: string;
  /** Shown after the question closes, to justify the answer. */
  note?: string;
}

export interface TriviaPack extends PackMeta {
  kind: "trivia";
  questions: TriviaQuestion[];
}

export type ContentPack = WordPack | DrawPack | TriviaPack;

/** What the lobby needs to offer a pack picker, with no content attached. */
export interface PackSummary extends PackMeta {
  kind: PackKind;
  /** Words or questions available. */
  size: number;
}
