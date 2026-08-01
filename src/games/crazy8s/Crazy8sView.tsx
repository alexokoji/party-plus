"use client";

import { useEffect, useRef, useState } from "react";
import { pulse, useFlipGroup } from "../../ui/motion";
import { CardBack, PlayingCard } from "../../ui/PlayingCard";
import { cardId, SUIT_GLYPH, type Suit } from "../holdem/cards";
import type { Crazy8sMove, Crazy8sPlayerView } from "./module";

export interface Crazy8sViewProps {
  view: Crazy8sPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: Crazy8sMove) => void;
}

const SUITS: Suit[] = ["s", "h", "d", "c"];
const SUIT_NAME: Record<Suit, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };

/**
 * Crazy 8s renderer.
 *
 * Uses the shared PlayingCard component (same one Hold'em draws with) and
 * reads only the module's redacted view: own hand in full, opponents as
 * counts. There is no code path here that could show someone else's cards.
 */
export function Crazy8sView({ view, playerId, isMyTurn, isPlaying, nameOf, onMove }: Crazy8sViewProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Cards leaving your hand close the gap they left, and the pile takes the
  // new card with a small landing beat rather than swapping it in place.
  useFlipGroup(tableRef, view.myHand.map((c) => cardId(c)).join("|"), { duration: 300 });
  useEffect(() => {
    pulse(topRef.current, "anim-play", 340);
  }, [view.topCard && cardId(view.topCard)]);
  const [pendingWild, setPendingWild] = useState<string | null>(null);

  useEffect(() => {
    if (!isMyTurn) setPendingWild(null);
  }, [isMyTurn]);

  const playable = new Set(view.playableCardIds);
  const wildRankInPlay = view.myHand.some((c) => playable.has(cardId(c)) && c.rank === 8);

  function play(id: string, rank: number) {
    if (!playable.has(id)) return;
    // An 8 needs a suit named before it can be sent.
    if (rank === 8) return setPendingWild(id);
    onMove({ type: "play", cardId: id });
  }

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            <>Match over — {nameOf(view.winners[0] ?? "")} sheds the last card.</>
          ) : isMyTurn ? (
            <strong>Your turn.</strong>
          ) : (
            <>
              Waiting on <strong>{nameOf(view.currentPlayerId ?? "")}</strong>…
            </>
          )}
          {view.pendingDraw > 0 && <span className="whot-debt">{view.pendingDraw} to pick up</span>}
          {view.activeSuit && (
            <span className="whot-demand">
              suit in play: {SUIT_GLYPH[view.activeSuit]} {SUIT_NAME[view.activeSuit]}
            </span>
          )}
          {view.direction === -1 && <span className="whot-demand">↺ reversed</span>}
        </p>
        <span className="whot-rules-badge">{view.rulesName}</span>
      </div>

      <div className="seat-strip">
        {view.opponents.map((o) => (
          <div key={o.id} className={`seat${view.currentPlayerId === o.id ? " active" : ""}`}>
            <span className="seat-name">{nameOf(o.id)}</span>
            <span className="seat-dice">
              {"🂠".repeat(Math.min(o.cardCount, 10))} {o.cardCount}
            </span>
            {o.cardCount === 1 && (
              <span className={o.announced ? "announced-ok" : "announced-missing"}>
                {o.announced ? "called last card" : "on one card!"}
              </span>
            )}
            {view.callableIds.includes(o.id) && isPlaying && (
              <button
                type="button"
                className="callout-button"
                onClick={() => onMove({ type: "callOut", targetId: o.id })}
              >
                Call them out
              </button>
            )}
          </div>
        ))}
        <div className={`seat viewer${view.currentPlayerId === playerId ? " active" : ""}`}>
          <span className="seat-name">{nameOf(playerId)} (you)</span>
          <span className="seat-dice">{view.myHand.length} cards</span>
        </div>
      </div>

      <div className="whot-table card-panel">
        <div className="whot-pile">
          <div className="whot-slot">
            <span className="whot-slot-label">Stock</span>
            <span className="whot-back">{view.stockCount}</span>
          </div>
          <div ref={topRef} className="whot-slot">
            <span className="whot-slot-label">Top card</span>
            {view.topCard ? <PlayingCard card={view.topCard} size="big" /> : <span>—</span>}
          </div>
        </div>

        {isPlaying && !view.finished && (
          <div className="table-actions">
            <button type="button" disabled={!isMyTurn} onClick={() => onMove({ type: "draw" })}>
              {view.pendingDraw > 0 ? `Pick up ${view.pendingDraw}` : "Draw"}
            </button>
            {isMyTurn && playable.size === 0 && (
              <button type="button" onClick={() => onMove({ type: "pass" })}>
                Pass
              </button>
            )}
            {view.shouldAnnounce && (
              <button type="button" className="announce-button" onClick={() => onMove({ type: "announce" })}>
                📣 Last card!
              </button>
            )}
          </div>
        )}
      </div>

      {pendingWild && (
        <div className="card-panel shape-chooser">
          <p>Crazy eight! Name a suit:</p>
          <div className="shape-buttons">
            {SUITS.map((suit) => (
              <button
                key={suit}
                type="button"
                onClick={() => {
                  onMove({ type: "play", cardId: pendingWild, declareSuit: suit });
                  setPendingWild(null);
                }}
              >
                {SUIT_GLYPH[suit]} {SUIT_NAME[suit]}
              </button>
            ))}
          </div>
          <button type="button" className="ghost" onClick={() => setPendingWild(null)}>
            Cancel
          </button>
        </div>
      )}

      {isPlaying && (
        <div className="card-panel play-panel">
          <h3 className="hand-heading">
            Your hand · {view.myHand.length} card{view.myHand.length === 1 ? "" : "s"}
            {view.mustAnnounceLastCard && view.shouldAnnounce && " · say it before they catch you!"}
          </h3>
          <div ref={tableRef} className="whot-hand">
            {view.myHand.map((c) => {
              const id = cardId(c);
              return (
                <button
                  key={id}
                  type="button"
                  data-flip={id}
                  className={`hand-card${playable.has(id) ? " playable" : ""}`}
                  disabled={!isMyTurn || !playable.has(id)}
                  onClick={() => play(id, c.rank)}
                >
                  <PlayingCard card={c} />
                </button>
              );
            })}
          </div>
          {isMyTurn && playable.size === 0 && !view.finished && (
            <p className="hint">
              {view.pendingDraw > 0 ? `Nothing to answer with — pick up ${view.pendingDraw}.` : "Nothing playable — draw."}
            </p>
          )}
          {isMyTurn && wildRankInPlay && <p className="hint">An 8 lets you name any suit.</p>}
        </div>
      )}

      {!isPlaying && <p className="spectator-note">👀 Spectating — you can see every hand.</p>}

      {view.seesAllHands && (view.finished || !isPlaying) && (
        <div className="card-panel">
          <h3 className="hand-heading">Hands</h3>
          <ul className="all-hands">
            {Object.entries(view.allHands).map(([owner, cards]) => (
              <li key={owner}>
                <strong>{nameOf(owner)}</strong>
                <span className="whot-hand small">
                  {cards.map((c) => (
                    <PlayingCard key={cardId(c)} card={c} size="small" />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export { CardBack };
