"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ensureIdentity } from "../client/identity";
import { equipItem, fetchWardrobe } from "../client/store";
import { itemsOfKind, ownsItem, STORE_ITEMS } from "../store/catalogue";
import { emptyWardrobe, formatNaira, type ItemKind, type Wardrobe } from "../store/types";

const SECTIONS: Array<{ kind: ItemKind; title: string; blurb: string }> = [
  { kind: "table", title: "Tables", blurb: "The felt your room plays on." },
  { kind: "cardback", title: "Card backs", blurb: "What everyone stares at all game." },
  { kind: "dice", title: "Dice", blurb: "Used anywhere dice are rolled." },
  { kind: "emotes", title: "Emotes", blurb: "Extra reactions in the room." },
  { kind: "pack", title: "Content packs", blurb: "More questions and words to draw from." },
];

/**
 * The Library and the store, in one place.
 *
 * Deliberately not two pages. "What I own" and "what I could own" are the same
 * question asked twice, and splitting them means someone has to remember which
 * page a thing was on. Owned items are simply marked owned and can be switched
 * on from here.
 *
 * Everything sold is cosmetic or content — nothing here changes what happens
 * in a game — and what a host equips applies to their whole room, so one
 * person buying is the whole table benefiting.
 */
export function LibraryView() {
  const [wardrobe, setWardrobe] = useState<Wardrobe>(emptyWardrobe());
  const [token, setToken] = useState("");
  const [guest, setGuest] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureIdentity()
      .then(async ({ token }) => {
        if (cancelled) return;
        setToken(token);
        const result = await fetchWardrobe(token);
        if (cancelled) return;
        setWardrobe(result.wardrobe);
        setGuest(result.guest);
      })
      .catch(() => setNote("Could not reach the server."));
    return () => {
      cancelled = true;
    };
  }, []);

  const owned = useMemo(
    () => STORE_ITEMS.filter((item) => ownsItem(wardrobe, item.id)),
    [wardrobe]
  );

  const use = useCallback(
    async (itemId: string) => {
      setBusy(itemId);
      setNote(null);
      try {
        setWardrobe(await equipItem(itemId, token));
      } catch (e) {
        setNote(e instanceof Error ? e.message : "Could not equip that.");
      } finally {
        setBusy(null);
      }
    },
    [token]
  );

  return (
    <div className="library">
      <div className="card-panel library-head">
        <div>
          <h2>Your library</h2>
          <p className="hint">
            {owned.length} item{owned.length === 1 ? "" : "s"} · what you equip applies to every
            room you host, for everyone at the table.
          </p>
        </div>
      </div>

      {guest && (
        <p className="hint library-guest">
          You are playing as a guest, so the free items work but nothing can be kept. Create an
          account to hold on to what you equip — and to anything you buy later.
        </p>
      )}
      {note && <p className="error-note">{note}</p>}

      {SECTIONS.map((section) => {
        const items = itemsOfKind(section.kind);
        if (items.length === 0) return null;
        return (
          <section className="library-section" key={section.kind}>
            <h3>{section.title}</h3>
            <p className="hint">{section.blurb}</p>
            <div className="library-grid">
              {items.map((item) => {
                const isOwned = ownsItem(wardrobe, item.id);
                const isOn = wardrobe.equipped[item.kind] === item.id;
                return (
                  <article
                    key={item.id}
                    className={`library-item${isOn ? " equipped" : ""}${isOwned ? "" : " locked"}`}
                    style={item.style as React.CSSProperties}
                  >
                    <span className="library-glyph" aria-hidden="true">
                      {item.glyph ?? "◆"}
                    </span>
                    <h4>{item.name}</h4>
                    <p>{item.description}</p>

                    {isOwned ? (
                      <button
                        type="button"
                        disabled={isOn || busy === item.id || guest}
                        onClick={() => void use(item.id)}
                        title={guest ? "Create an account to keep this" : undefined}
                      >
                        {isOn ? "✓ In use" : busy === item.id ? "…" : "Use this"}
                      </button>
                    ) : (
                      <button type="button" disabled title="Checkout is not connected yet">
                        {formatNaira(item.priceKobo)}
                      </button>
                    )}

                    {item.free && <span className="library-tag">Included</span>}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="hint library-footnote">
        Nothing sold here changes what happens in a game — no extra rolls, no hints, no bigger
        hand. Voice chat, every game and every room stay free.
      </p>
    </div>
  );
}
