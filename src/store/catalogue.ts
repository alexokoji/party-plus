import type { ItemKind, StoreItem, Wardrobe } from "./types";

/**
 * What is for sale.
 *
 * Deliberately small and entirely cosmetic. Every entry either changes how
 * something looks or adds content to draw from — nothing here touches a rule,
 * a roll, or a hand.
 *
 * The free items are not filler: they are what makes the Library a real place
 * on day one, before anyone has spent anything, and they prove the equip path
 * works without a payment provider existing.
 */
export const STORE_ITEMS: StoreItem[] = [
  // ---- tables ----
  {
    id: "table-classic",
    name: "Classic Green",
    description: "The felt everyone already knows.",
    kind: "table",
    priceKobo: 0,
    free: true,
    glyph: "🟢",
    style: { "--felt": "#1f4630", "--felt-edge": "#2f5c42" },
  },
  {
    id: "table-midnight",
    name: "Midnight",
    description: "Deep blue felt for late sessions.",
    kind: "table",
    priceKobo: 50000,
    glyph: "🔵",
    style: { "--felt": "#152a45", "--felt-edge": "#24406a" },
  },
  {
    id: "table-ankara",
    name: "Ankara",
    description: "Warm ochre and indigo, after the cloth.",
    kind: "table",
    priceKobo: 80000,
    glyph: "🟠",
    style: { "--felt": "#5b3a1a", "--felt-edge": "#8a5a24" },
  },

  // ---- card backs ----
  {
    id: "cardback-classic",
    name: "Classic Red",
    description: "Standard issue.",
    kind: "cardback",
    priceKobo: 0,
    free: true,
    glyph: "🂠",
    style: { "--card-back": "#8c2f2f", "--card-back-ink": "#f3e6c8" },
  },
  {
    id: "cardback-naija",
    name: "Naija Green",
    description: "Green and white, with a cowrie pattern.",
    kind: "cardback",
    priceKobo: 50000,
    glyph: "🇳🇬",
    style: { "--card-back": "#0d6b3f", "--card-back-ink": "#f4f7f2" },
  },
  {
    id: "cardback-gold",
    name: "Gold Leaf",
    description: "For people who bluff in style.",
    kind: "cardback",
    priceKobo: 120000,
    glyph: "✨",
    style: { "--card-back": "#2a2318", "--card-back-ink": "#e8c85a" },
  },

  // ---- dice ----
  {
    id: "dice-ivory",
    name: "Ivory",
    description: "Bone white, black pips.",
    kind: "dice",
    priceKobo: 0,
    free: true,
    glyph: "🎲",
    style: { "--die-face": "#f6f1e4", "--die-pip": "#241f1a" },
  },
  {
    id: "dice-obsidian",
    name: "Obsidian",
    description: "Black dice, gold pips.",
    kind: "dice",
    priceKobo: 70000,
    glyph: "⚫",
    style: { "--die-face": "#1c1a17", "--die-pip": "#e8c85a" },
  },

  // ---- emotes ----
  {
    id: "emotes-naija",
    name: "Naija Emotes",
    description: "Six reactions that need no translation.",
    kind: "emotes",
    priceKobo: 40000,
    glyph: "😂",
  },

  // ---- content ----
  {
    id: "pack-trivia-naija-pro",
    name: "Naija Trivia: Deep Cuts",
    description: "A harder Nigerian question set for people who win too easily.",
    kind: "pack",
    priceKobo: 100000,
    packId: "trivia-naija-pro",
    glyph: "❓",
  },
];

export const getItem = (id: string): StoreItem | null =>
  STORE_ITEMS.find((item) => item.id === id) ?? null;

export const itemsOfKind = (kind: ItemKind): StoreItem[] =>
  STORE_ITEMS.filter((item) => item.kind === kind);

/** Free items are owned by everybody, without ever being bought. */
export const FREE_ITEM_IDS = STORE_ITEMS.filter((i) => i.free).map((i) => i.id);

export function ownsItem(wardrobe: Wardrobe, id: string): boolean {
  return FREE_ITEM_IDS.includes(id) || wardrobe.owned.includes(id);
}

/**
 * Equipping, checked here rather than trusted from the client.
 *
 * The client decides what to ask for; whether it is allowed is decided from
 * the catalogue and what the player actually owns. Returning the wardrobe
 * unchanged on a refusal keeps the caller simple — there is nothing to undo.
 */
export function equip(wardrobe: Wardrobe, id: string): { wardrobe: Wardrobe; error?: string } {
  const item = getItem(id);
  if (!item) return { wardrobe, error: "no such item" };
  if (!ownsItem(wardrobe, id)) return { wardrobe, error: "you do not own that yet" };
  return { wardrobe: { ...wardrobe, equipped: { ...wardrobe.equipped, [item.kind]: id } } };
}

/** The CSS variables for everything currently equipped. */
export function equippedStyle(wardrobe: Wardrobe): Record<string, string> {
  const style: Record<string, string> = {};
  for (const id of Object.values(wardrobe.equipped)) {
    const item = id ? getItem(id) : null;
    if (item?.style) Object.assign(style, item.style);
  }
  return style;
}

/** Content packs a player has unlocked, for the lobby's pack picker. */
export function unlockedPackIds(wardrobe: Wardrobe): string[] {
  return STORE_ITEMS.filter((i) => i.kind === "pack" && i.packId && ownsItem(wardrobe, i.id))
    .map((i) => i.packId!)
    .filter(Boolean);
}
