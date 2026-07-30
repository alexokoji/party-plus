/**
 * The hidden-hand redaction shape, shared by every card game where players
 * hold cards nobody else may see (Whot, Crazy 8s).
 *
 * The rule this encodes: a recipient gets their own hand in full and, for
 * everyone else, a *count* and nothing more. Building the opponent entry here
 * — rather than each module copying a spread-and-delete — means there is one
 * place a leak could be introduced, and it is covered by tests.
 */

export interface HandHolder<TCard> {
  id: string;
  hand: TCard[];
}

export interface OpponentSummary {
  id: string;
  cardCount: number;
}

export interface RedactedHands<TCard> {
  /** The recipient's own cards. Empty for a pure spectator. */
  myHand: TCard[];
  /** Counts only — never the cards themselves. */
  opponents: OpponentSummary[];
  /** True when this recipient may see everything (spectator, or match over). */
  seesAllHands: boolean;
  /** Populated only when seesAllHands; otherwise an empty object. */
  allHands: Record<string, TCard[]>;
}

export interface RedactOptions {
  /** Null means a pure spectator, who never held a seat. */
  viewerId: string | null;
  /** Open every hand — set once the match is decided. */
  revealAll?: boolean;
}

/**
 * Splits players' hands into what one recipient is entitled to see.
 *
 * Opponent entries are constructed field by field on purpose: copying an
 * opponent and deleting `hand` would leak the moment a new field is added to
 * the player type.
 */
export function redactHands<TCard, TPlayer extends HandHolder<TCard>>(
  players: TPlayer[],
  { viewerId, revealAll = false }: RedactOptions
): RedactedHands<TCard> {
  const seesAllHands = viewerId === null || revealAll;
  const me = viewerId ? players.find((p) => p.id === viewerId) ?? null : null;

  return {
    myHand: me ? [...me.hand] : [],
    opponents: players
      .filter((p) => p.id !== viewerId)
      .map((p) => ({ id: p.id, cardCount: p.hand.length })),
    seesAllHands,
    allHands: seesAllHands
      ? Object.fromEntries(players.map((p) => [p.id, [...p.hand]]))
      : {},
  };
}
