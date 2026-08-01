/**
 * The store.
 *
 * One rule decides what may be sold here: **nothing may change what happens in
 * a game.** No extra dice, no trivia hints, no bigger hand. The moment a
 * purchase affects an outcome, every win in a competitive social game becomes
 * arguable, and the trust that makes people invite their friends is gone.
 *
 * So the catalogue is looks and content: table felts, card backs, dice, avatar
 * frames, emote packs, and question packs that add variety rather than
 * advantage. A host's purchase applies to their whole room, which is the point
 * — one person buys, everyone at the table gets the benefit, and nobody who
 * joined a link is ever asked for money.
 */

export type ItemKind = "table" | "cardback" | "dice" | "avatar" | "emotes" | "pack";

export interface StoreItem {
  id: string;
  name: string;
  description: string;
  kind: ItemKind;
  /**
   * Price in kobo (₦1 = 100 kobo).
   *
   * Integer minor units, never floats: 0.1 + 0.2 is not 0.3, and money that
   * drifts by a kobo per transaction is a support ticket nobody can explain.
   */
  priceKobo: number;
  /** Free items still live in the catalogue, so everything equips the same way. */
  free?: boolean;
  /** CSS custom properties applied when equipped. Cosmetics only. */
  style?: Record<string, string>;
  /** For "pack" items: the content pack this unlocks. */
  packId?: string;
  /** Shown on the card. Emoji or a short glyph — no image requests. */
  glyph?: string;
}

/** What a player owns and what they have chosen to use. */
export interface Wardrobe {
  owned: string[];
  /** One equipped item per kind. */
  equipped: Partial<Record<ItemKind, string>>;
}

export const emptyWardrobe = (): Wardrobe => ({ owned: [], equipped: {} });

export const formatNaira = (kobo: number): string =>
  kobo === 0 ? "Free" : `₦${(kobo / 100).toLocaleString("en-NG")}`;
