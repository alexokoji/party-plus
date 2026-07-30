"use client";

import { cardLabel, SUIT_GLYPH, type Card } from "../games/holdem/cards";

export interface PlayingCardProps {
  card: Card;
  size?: "small" | "normal" | "big";
  className?: string;
}

/**
 * A standard 52-card playing card.
 *
 * Shared by every game that uses a French-suited deck (Hold'em, Crazy 8s), so
 * the card face is defined once. Whot keeps its own renderer because its deck
 * is shape-suited and looks nothing like this.
 */
export function PlayingCard({ card, size = "normal", className = "" }: PlayingCardProps) {
  const red = card.suit === "h" || card.suit === "d";
  const label = cardLabel(card);
  return (
    <span
      className={`poker-card${red ? " red" : ""}${size !== "normal" ? ` ${size}` : ""} ${className}`}
      title={label}
    >
      <span className="poker-rank">{label.slice(0, -1)}</span>
      <span className="poker-suit">{SUIT_GLYPH[card.suit]}</span>
    </span>
  );
}

export function CardBack({ size = "normal" }: { size?: "small" | "normal" | "big" }) {
  return <span className={`poker-card back${size !== "normal" ? ` ${size}` : ""}`} aria-label="hidden card" />;
}

export function CardSlot() {
  return <span className="poker-card slot" />;
}
