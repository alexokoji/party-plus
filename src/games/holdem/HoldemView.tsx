"use client";

import { useEffect, useMemo, useState } from "react";
import { cardLabel, SUIT_GLYPH, type Card } from "./cards";
import type { HoldemMove, HoldemPlayerView } from "./module";

export interface HoldemViewProps {
  view: HoldemPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: HoldemMove) => void;
}

const STREET_LABEL: Record<string, string> = {
  preflop: "Pre-flop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

function PlayingCard({ card, small = false }: { card: Card; small?: boolean }) {
  const red = card.suit === "h" || card.suit === "d";
  return (
    <span className={`poker-card${red ? " red" : ""}${small ? " small" : ""}`} title={cardLabel(card)}>
      <span className="poker-rank">{cardLabel(card).slice(0, -1)}</span>
      <span className="poker-suit">{SUIT_GLYPH[card.suit]}</span>
    </span>
  );
}

function CardBack({ small = false }: { small?: boolean }) {
  return <span className={`poker-card back${small ? " small" : ""}`} aria-label="hidden card" />;
}

export function HoldemView({ view, playerId, isMyTurn, isPlaying, nameOf, onMove }: HoldemViewProps) {
  const legal = new Set(view.legalMoves);
  const canRaise = legal.has("raise") || legal.has("bet");

  const maxRaiseTo = (view.me?.chips ?? 0) + (view.me?.committed ?? 0);
  const minTo = legal.has("bet")
    ? Math.max(view.bigBlind, 1)
    : Math.min(view.minRaiseTo, maxRaiseTo);

  const [raiseTo, setRaiseTo] = useState(minTo);

  // Keep the slider inside the legal band as the hand moves on.
  useEffect(() => {
    setRaiseTo((current) => Math.min(Math.max(current, minTo), maxRaiseTo));
  }, [minTo, maxRaiseTo, view.handNumber, view.street]);

  const showdown = view.showdown;
  const winnersById = useMemo(
    () => new Set((showdown ?? []).filter((s) => s.won > 0).map((s) => s.playerId)),
    [showdown]
  );

  function submitRaise() {
    const amount = Math.min(Math.max(raiseTo, minTo), maxRaiseTo);
    // A raise that would commit the whole stack is an all-in, which the server
    // validates differently — send the move it will actually accept.
    if (amount >= maxRaiseTo && legal.has("allIn")) return onMove({ type: "allIn" });
    onMove(legal.has("bet") ? { type: "bet", amount } : { type: "raise", amount });
  }

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          {view.finished ? (
            <>Table over — {nameOf(view.winners[0] ?? "")} takes every chip.</>
          ) : view.handComplete ? (
            <strong>Hand {view.handNumber} complete.</strong>
          ) : isMyTurn ? (
            <strong>Your action.</strong>
          ) : (
            <>
              Waiting on <strong>{nameOf(view.currentPlayerId ?? "")}</strong>…
            </>
          )}{" "}
          <span className="street-badge">{STREET_LABEL[view.street] ?? view.street}</span>
        </p>
        <span className="play-money-badge" title="Chips have no monetary value and cannot be cashed out">
          🪙 Play money only
        </span>
      </div>

      <div className="poker-table card-panel">
        <div className="poker-pot">
          <span className="pot-label">Pot</span>
          <span className="pot-amount">{view.pot}</span>
          {view.pots.length > 1 && (
            <span className="side-pots">
              {view.pots.map((p, i) => (
                <span key={i} className="side-pot">
                  {i === 0 ? "main" : `side ${i}`}: {p.amount}
                </span>
              ))}
            </span>
          )}
        </div>

        <div className="poker-board">
          {view.board.map((card) => (
            <PlayingCard key={`${card.rank}${card.suit}`} card={card} />
          ))}
          {Array.from({ length: 5 - view.board.length }, (_, i) => (
            <span key={`slot${i}`} className="poker-card slot" />
          ))}
        </div>

        <div className="blinds-note">
          blinds {view.smallBlind}/{view.bigBlind}
          {view.buttonId ? ` · button: ${nameOf(view.buttonId)}` : ""}
        </div>
      </div>

      <div className="poker-seats">
        {view.opponents.map((o) => {
          const entry = showdown?.find((s) => s.playerId === o.id);
          return (
            <div
              key={o.id}
              className={[
                "poker-seat",
                o.folded ? "folded" : "",
                o.busted ? "busted" : "",
                view.currentPlayerId === o.id ? "active" : "",
                winnersById.has(o.id) ? "winner" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="poker-seat-head">
                <strong>{nameOf(o.id)}</strong>
                <span className="chips">{o.chips}</span>
              </div>
              <div className="poker-seat-cards">
                {o.revealed
                  ? o.revealed.map((c) => <PlayingCard key={`${c.rank}${c.suit}`} card={c} small />)
                  : Array.from({ length: o.cardCount }, (_, i) => <CardBack key={i} small />)}
              </div>
              <div className="poker-seat-foot">
                {o.busted ? "busted" : o.folded ? "folded" : o.allIn ? "all in" : o.committed > 0 ? `bet ${o.committed}` : "—"}
                {entry?.hand ? ` · ${entry.hand.label}` : ""}
              </div>
            </div>
          );
        })}
      </div>

      {isPlaying && view.me && (
        <div className="card-panel play-panel">
          <div className="my-seat">
            <div>
              <h3 className="hand-heading">
                Your hand · {view.me.chips} chips
                {view.me.committed > 0 ? ` · in for ${view.me.committed}` : ""}
              </h3>
              <div className="poker-seat-cards big">
                {view.myHole.map((c) => (
                  <PlayingCard key={`${c.rank}${c.suit}`} card={c} />
                ))}
                {view.myHole.length === 0 && <span className="hint">Sitting out this hand.</span>}
              </div>
              {view.myBestHand && <p className="best-hand">Best: {view.myBestHand.label}</p>}
            </div>
          </div>

          {view.handComplete && !view.finished && (
            <button type="button" onClick={() => onMove({ type: "check" })}>
              Deal next hand
            </button>
          )}

          {!view.handComplete && !view.finished && (
            <div className="bet-controls">
              <div className="bet-buttons">
                <button type="button" disabled={!isMyTurn || !legal.has("fold")} onClick={() => onMove({ type: "fold" })}>
                  Fold
                </button>
                <button type="button" disabled={!isMyTurn || !legal.has("check")} onClick={() => onMove({ type: "check" })}>
                  Check
                </button>
                <button type="button" disabled={!isMyTurn || !legal.has("call")} onClick={() => onMove({ type: "call" })}>
                  Call {view.toCall > 0 ? view.toCall : ""}
                </button>
                <button
                  type="button"
                  className="challenge-button"
                  disabled={!isMyTurn || !legal.has("allIn")}
                  onClick={() => onMove({ type: "allIn" })}
                >
                  All in ({view.me.chips})
                </button>
              </div>

              {canRaise && (
                <div className="raise-row">
                  <label>
                    <span>{legal.has("bet") ? "Bet" : "Raise to"}</span>
                    <input
                      type="range"
                      min={minTo}
                      max={maxRaiseTo}
                      value={raiseTo}
                      disabled={!isMyTurn}
                      onChange={(e) => setRaiseTo(Number(e.target.value))}
                    />
                  </label>
                  <input
                    type="number"
                    className="raise-number"
                    min={minTo}
                    max={maxRaiseTo}
                    value={raiseTo}
                    disabled={!isMyTurn}
                    onChange={(e) => setRaiseTo(Number(e.target.value))}
                  />
                  <button type="button" disabled={!isMyTurn} onClick={submitRaise}>
                    {legal.has("bet") ? `Bet ${raiseTo}` : `Raise to ${raiseTo}`}
                  </button>
                </div>
              )}
              {isMyTurn && view.toCall > 0 && <p className="hint">{view.toCall} to call.</p>}
            </div>
          )}
        </div>
      )}

      {!isPlaying && <p className="spectator-note">👀 Spectating — hole cards stay hidden until showdown.</p>}

      {showdown && showdown.some((s) => s.hand) && (
        <div className="card-panel">
          <h3 className="hand-heading">Showdown</h3>
          <ul className="all-hands">
            {showdown.map((entry) => (
              <li key={entry.playerId} className={entry.won > 0 ? "winner" : ""}>
                <strong>{nameOf(entry.playerId)}</strong>
                <span className="poker-seat-cards">
                  {entry.hole.map((c) => (
                    <PlayingCard key={`${c.rank}${c.suit}`} card={c} small />
                  ))}
                </span>
                <em>{entry.hand?.label}</em>
                {entry.won > 0 && <span className="won-chips">+{entry.won}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="play-money-footnote">
        Chips are points for this table only — there is no buy-in, no cash-out, and nothing of value at stake.
      </p>
    </>
  );
}
