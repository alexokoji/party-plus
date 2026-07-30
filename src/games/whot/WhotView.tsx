"use client";

import { useEffect, useState } from "react";
import { SHAPES, SHAPE_GLYPH, type Shape } from "./rules";
import type { WhotCard } from "./deck";
import type { WhotMove, WhotPlayerView } from "./module";

export interface WhotViewProps {
  view: WhotPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: WhotMove) => void;
}

function CardFace({ card, className = "" }: { card: WhotCard; className?: string }) {
  const isWhot = card.shape === "whot";
  return (
    <span className={`whot-card ${isWhot ? "whot-wild" : `shape-${card.shape}`} ${className}`}>
      <span className="whot-number">{card.number}</span>
      <span className="whot-glyph">{isWhot ? "WHOT" : SHAPE_GLYPH[card.shape as Shape]}</span>
    </span>
  );
}

/**
 * Whot renderer.
 *
 * Reads only the module's redacted view: it receives its own hand and nothing
 * but card *counts* for everyone else, so there is no version of this
 * component that could accidentally show an opponent's cards.
 */
export function WhotView({ view, playerId, isMyTurn, isPlaying, nameOf, onMove }: WhotViewProps) {
  const [pendingWild, setPendingWild] = useState<string | null>(null);

  // Close the shape chooser if the turn moves on while it is open.
  useEffect(() => {
    if (!isMyTurn) setPendingWild(null);
  }, [isMyTurn]);

  const playable = new Set(view.playableCardIds);
  const owedText =
    view.pendingDraw > 0
      ? `${view.pendingDraw} to pick${view.pendingKind === "pickThree" ? " (pick three)" : " (pick two)"}`
      : null;

  function playCard(card: WhotCard) {
    if (!playable.has(card.id)) return;
    if (card.shape === "whot") {
      setPendingWild(card.id);
      return;
    }
    onMove({ type: "play", cardId: card.id });
  }

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            <>
              Match over —{" "}
              {view.winners.length ? view.winners.map(nameOf).join(", ") : "nobody"} wins.
            </>
          ) : isMyTurn ? (
            <strong>Your turn.</strong>
          ) : (
            <>
              Waiting on <strong>{nameOf(view.currentPlayerId ?? "")}</strong>…
            </>
          )}{" "}
          {owedText && <span className="whot-debt">{owedText}</span>}
          {view.requestedShape && (
            <span className="whot-demand">
              asked for {SHAPE_GLYPH[view.requestedShape]} {view.requestedShape}
            </span>
          )}
        </p>
        <span className="whot-rules-badge">{view.rulesName}</span>
      </div>

      <div className="seat-strip">
        {view.opponents.map((o) => (
          <div key={o.id} className={`seat${view.currentPlayerId === o.id ? " active" : ""}`}>
            <span className="seat-name">{nameOf(o.id)}</span>
            <span className="seat-dice">
              {"🂠".repeat(Math.min(o.cardCount, 12))} {o.cardCount}
            </span>
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
            <span className="whot-slot-label">Market</span>
            <span className="whot-back">{view.marketCount}</span>
          </div>
          <div className="whot-slot">
            <span className="whot-slot-label">Top card</span>
            {view.topCard ? <CardFace card={view.topCard} className="big" /> : <span>—</span>}
          </div>
        </div>

        {isPlaying && !view.finished && (
          <button
            type="button"
            className="market-button"
            disabled={!isMyTurn}
            onClick={() => onMove({ type: "draw" })}
          >
            {view.pendingDraw > 0 ? `Pick ${view.pendingDraw}` : "Go to market"}
          </button>
        )}
      </div>

      {pendingWild && (
        <div className="card-panel shape-chooser">
          <p>Whot! Name a shape:</p>
          <div className="shape-buttons">
            {SHAPES.map((shape) => (
              <button
                key={shape}
                type="button"
                onClick={() => {
                  onMove({ type: "play", cardId: pendingWild, requestShape: shape });
                  setPendingWild(null);
                }}
              >
                {SHAPE_GLYPH[shape]} {shape}
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
          </h3>
          <div className="whot-hand">
            {view.myHand.map((card) => (
              <button
                key={card.id}
                type="button"
                className={`hand-card${playable.has(card.id) ? " playable" : ""}`}
                disabled={!isMyTurn || !playable.has(card.id)}
                onClick={() => playCard(card)}
              >
                <CardFace card={card} />
              </button>
            ))}
          </div>
          {isMyTurn && playable.size === 0 && !view.finished && (
            <p className="hint">Nothing playable — go to market.</p>
          )}
        </div>
      )}

      {!isPlaying && !view.finished && (
        <p className="spectator-note">👀 Spectating — you can see every hand.</p>
      )}

      {(view.seesAllHands && (view.finished || !isPlaying)) && (
        <div className="card-panel">
          <h3>Hands</h3>
          <ul className="all-hands">
            {Object.entries(view.allHands).map(([owner, cards]) => (
              <li key={owner}>
                <strong>{nameOf(owner)}</strong>
                <span className="whot-hand small">
                  {cards.map((c) => (
                    <CardFace key={c.id} card={c} />
                  ))}
                </span>
                {view.handTotals && <em> · {view.handTotals[owner]} pts</em>}
              </li>
            ))}
          </ul>
          {view.endReason === "marketExhausted" && (
            <p className="hint">Market ran out — settled on hand totals.</p>
          )}
        </div>
      )}
    </>
  );
}
