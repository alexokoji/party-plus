"use client";

import { useEffect, useMemo, useState } from "react";
import type { Bid, Face } from "../engine/types";

const FACES: Face[] = [1, 2, 3, 4, 5, 6];

export interface BidControlsProps {
  legalBids: Bid[];
  currentBid: Bid | null;
  palifico: boolean;
  canChallenge: boolean;
  disabled: boolean;
  onBid: (bid: Bid) => void;
  onChallenge: () => void;
}

/**
 * Bid entry constrained to legal moves. `legalBids` comes from the same
 * isValidBidTransition the engine validates with, so the UI cannot offer a
 * move the server would reject — the Perudo raise rules (wild-ones halving,
 * doubling back off ones, palifico locking the face) are fiddly enough that
 * free-form entry would mostly produce rejections.
 */
export function BidControls({
  legalBids,
  currentBid,
  palifico,
  canChallenge,
  disabled,
  onBid,
  onChallenge,
}: BidControlsProps) {
  const facesAvailable = useMemo(
    () => FACES.filter((face) => legalBids.some((b) => b.face === face)),
    [legalBids]
  );

  const [face, setFace] = useState<Face | null>(facesAvailable[0] ?? null);

  // Keep the selected face valid as the legal set changes between turns.
  useEffect(() => {
    if (face === null || !facesAvailable.includes(face)) {
      setFace(facesAvailable[0] ?? null);
    }
  }, [facesAvailable, face]);

  const quantitiesForFace = useMemo(
    () => (face === null ? [] : legalBids.filter((b) => b.face === face).map((b) => b.quantity).sort((a, b) => a - b)),
    [legalBids, face]
  );

  const [quantity, setQuantity] = useState<number | null>(null);

  useEffect(() => {
    if (quantity === null || !quantitiesForFace.includes(quantity)) {
      setQuantity(quantitiesForFace[0] ?? null);
    }
  }, [quantitiesForFace, quantity]);

  const canBid = !disabled && face !== null && quantity !== null;

  return (
    <div className="bid-controls">
      {palifico && (
        <p className="palifico-note">
          <strong>Palifico</strong> — someone is down to their last die: ones are not wild and the face is
          locked for this round.
        </p>
      )}
      <div className="bid-row">
        <label>
          <span>Quantity</span>
          <select
            value={quantity ?? ""}
            disabled={disabled || quantitiesForFace.length === 0}
            onChange={(e) => setQuantity(Number(e.target.value))}
          >
            {quantitiesForFace.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </label>

        <div className="face-picker" role="group" aria-label="Face">
          {FACES.map((f) => {
            const available = facesAvailable.includes(f);
            return (
              <button
                key={f}
                type="button"
                className={`face-chip${face === f ? " selected" : ""}`}
                disabled={disabled || !available}
                aria-pressed={face === f}
                onClick={() => setFace(f)}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bid-actions">
        <button
          type="button"
          disabled={!canBid}
          onClick={() => face !== null && quantity !== null && onBid({ quantity, face })}
        >
          Bid {quantity ?? "—"} × {face ?? "—"}
        </button>
        <button
          type="button"
          className="challenge-button"
          disabled={disabled || !canChallenge}
          onClick={onChallenge}
        >
          🚨 Call bluff
          {currentBid ? ` on ${currentBid.quantity} × ${currentBid.face}` : ""}
        </button>
      </div>
    </div>
  );
}
