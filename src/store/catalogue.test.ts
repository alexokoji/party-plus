import { describe, it, expect } from "vitest";
import {
  equip,
  equippedStyle,
  FREE_ITEM_IDS,
  getItem,
  itemsOfKind,
  ownsItem,
  STORE_ITEMS,
  unlockedPackIds,
} from "./catalogue";
import { emptyWardrobe, formatNaira, type Wardrobe } from "./types";

const wardrobe = (over: Partial<Wardrobe> = {}): Wardrobe => ({ ...emptyWardrobe(), ...over });

describe("what is for sale", () => {
  /**
   * The rule the whole store rests on. The moment a purchase can change an
   * outcome, every win in a competitive social game becomes arguable.
   */
  it("sells nothing that could affect a game's outcome", () => {
    for (const item of STORE_ITEMS) {
      expect(["table", "cardback", "dice", "avatar", "emotes", "pack"]).toContain(item.kind);
      // Cosmetics may only carry CSS custom properties.
      for (const key of Object.keys(item.style ?? {})) {
        expect(key.startsWith("--"), `${item.id} sets ${key}`).toBe(true);
      }
    }
  });

  it("prices everything in whole kobo", () => {
    for (const item of STORE_ITEMS) {
      expect(Number.isInteger(item.priceKobo), item.id).toBe(true);
      expect(item.priceKobo).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives every kind at least one free option", () => {
    // Otherwise a section of the Library is a wall of locked tiles, which is
    // the coercive feel this is meant to avoid.
    for (const kind of ["table", "cardback", "dice"] as const) {
      expect(itemsOfKind(kind).some((i) => i.free), kind).toBe(true);
    }
  });

  it("has unique ids", () => {
    expect(new Set(STORE_ITEMS.map((i) => i.id)).size).toBe(STORE_ITEMS.length);
  });
});

describe("ownership", () => {
  it("gives free items to everybody, bought or not", () => {
    for (const id of FREE_ITEM_IDS) expect(ownsItem(emptyWardrobe(), id)).toBe(true);
  });

  it("does not give away anything priced", () => {
    const paid = STORE_ITEMS.find((i) => !i.free)!;
    expect(ownsItem(emptyWardrobe(), paid.id)).toBe(false);
    expect(ownsItem(wardrobe({ owned: [paid.id] }), paid.id)).toBe(true);
  });
});

describe("equipping", () => {
  it("equips something you own", () => {
    const free = STORE_ITEMS.find((i) => i.free && i.kind === "table")!;
    const result = equip(emptyWardrobe(), free.id);
    expect(result.error).toBeUndefined();
    expect(result.wardrobe.equipped.table).toBe(free.id);
  });

  it("refuses something you do not own, whatever the client asks for", () => {
    const paid = STORE_ITEMS.find((i) => !i.free)!;
    const result = equip(emptyWardrobe(), paid.id);
    expect(result.error).toMatch(/do not own/);
    expect(result.wardrobe).toEqual(emptyWardrobe());
  });

  it("refuses an item that does not exist", () => {
    expect(equip(emptyWardrobe(), "table-does-not-exist").error).toMatch(/no such item/);
  });

  it("replaces rather than accumulates within a kind", () => {
    const tables = itemsOfKind("table");
    const start = wardrobe({ owned: tables.map((t) => t.id) });
    const first = equip(start, tables[0]!.id).wardrobe;
    const second = equip(first, tables[1]!.id).wardrobe;
    expect(second.equipped.table).toBe(tables[1]!.id);
    expect(Object.keys(second.equipped)).toHaveLength(1);
  });

  it("keeps different kinds side by side", () => {
    let w = emptyWardrobe();
    w = equip(w, "table-classic").wardrobe;
    w = equip(w, "cardback-classic").wardrobe;
    expect(w.equipped).toMatchObject({ table: "table-classic", cardback: "cardback-classic" });
  });
});

describe("what equipping produces", () => {
  it("collects the CSS variables of everything in use", () => {
    let w = emptyWardrobe();
    w = equip(w, "table-classic").wardrobe;
    w = equip(w, "dice-ivory").wardrobe;
    const style = equippedStyle(w);
    expect(style["--felt"]).toBeTruthy();
    expect(style["--die-face"]).toBeTruthy();
  });

  it("produces nothing for an empty wardrobe", () => {
    expect(equippedStyle(emptyWardrobe())).toEqual({});
  });

  it("unlocks a content pack only once it is owned", () => {
    const packItem = STORE_ITEMS.find((i) => i.kind === "pack")!;
    expect(unlockedPackIds(emptyWardrobe())).toEqual([]);
    expect(unlockedPackIds(wardrobe({ owned: [packItem.id] }))).toEqual([packItem.packId]);
  });
});

describe("prices as people read them", () => {
  it("shows naira, not kobo", () => {
    expect(formatNaira(50000)).toBe("₦500");
    expect(formatNaira(120000)).toBe("₦1,200");
  });

  it("says Free rather than ₦0", () => {
    expect(formatNaira(0)).toBe("Free");
  });
});

describe("the catalogue is findable", () => {
  it("looks an item up by id", () => {
    expect(getItem("table-classic")?.kind).toBe("table");
    expect(getItem("nope")).toBeNull();
  });
});
