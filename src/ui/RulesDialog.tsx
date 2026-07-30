"use client";

import { useEffect, useRef } from "react";

export interface RulesDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Rules explainer. Uses a native <dialog> so focus trapping, Escape-to-close
 * and the backdrop come from the platform rather than hand-rolled listeners.
 */
export function RulesDialog({ open, onClose }: RulesDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="rules-dialog" onClose={onClose}>
      <div className="rules-head">
        <h2>How to play Liar&apos;s Dice</h2>
        <button type="button" className="close-button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="rules-body">
        <section>
          <h3>The idea</h3>
          <p>
            Everyone starts with <strong>5 dice</strong>, rolled in secret — you can see your own dice,
            nobody else&apos;s. Players take turns <em>claiming</em> how many dice of a given number are on
            the table <strong>counting everyone&apos;s dice together</strong>, not just their own.
          </p>
          <p>
            Each claim must be bigger than the last, so the numbers climb until somebody thinks the
            current claim is a lie — and calls it. Whoever is wrong loses a die. Lose all five and
            you&apos;re out. Last player standing wins.
          </p>
        </section>

        <section>
          <h3>What a bid means</h3>
          <p>
            A bid of <strong>4 × 3</strong> means &ldquo;I reckon there are <strong>at least four 3s</strong>
            among all the dice on this table.&rdquo; It does not mean you hold four 3s. You might hold none —
            you&apos;re betting on what everyone else is hiding.
          </p>
        </section>

        <section>
          <h3>Raising</h3>
          <p>On your turn you must raise the previous bid. A raise is either:</p>
          <ul>
            <li>the <strong>same number, a higher quantity</strong> — 4 × 3 → 5 × 3, or</li>
            <li>a <strong>higher number, same quantity or more</strong> — 4 × 3 → 4 × 5.</li>
          </ul>
          <p>You can never go backwards. If you don&apos;t want to raise, call bluff instead.</p>
        </section>

        <section>
          <h3>Calling bluff</h3>
          <p>
            &ldquo;Call bluff&rdquo; means <strong>you think the current bid is too high to be true</strong>.
            Everyone reveals their dice and the matching dice get counted:
          </p>
          <ul>
            <li>If there are <strong>fewer</strong> than the bid claimed, the bidder was lying — <strong>they</strong> lose a die.</li>
            <li>If there are <strong>at least</strong> as many as claimed, the bid was good — <strong>you</strong> lose a die for doubting.</li>
          </ul>
          <p>Either way a die is gone, everyone rerolls, and the next round starts.</p>
        </section>

        <section>
          <h3>Ones are wild</h3>
          <p>
            <strong>1s count as any number.</strong> If the bid is 4 × 3, then every 3 <em>and</em> every 1 on
            the table counts toward it. This makes bids easier to hit than they look.
          </p>
          <p>Because 1s are powerful, bidding on 1s itself has special rules:</p>
          <ul>
            <li>Switching to 1s: you need <strong>half the current quantity, rounded up</strong> — 8 × 4 → 5 × 1.</li>
            <li>Switching off 1s: you need <strong>double it, plus one</strong> — 4 × 1 → 9 × 2.</li>
          </ul>
        </section>

        <section>
          <h3>Palifico</h3>
          <p>
            When a player is down to their <strong>last single die</strong>, the round is
            &ldquo;palifico&rdquo;: <strong>1s stop being wild</strong>, and the number named in the first bid
            is <strong>locked for the whole round</strong> — players may only raise the quantity.
          </p>
        </section>

        <section>
          <h3>Reading the table</h3>
          <p>
            The panel above shows each player and how many dice they still hold. The felt shows every
            die in play: yours face-up, everyone else&apos;s blank until a challenge reveals them. Knocked
            out? You keep watching, and you get to see everybody&apos;s dice.
          </p>
        </section>

        <section>
          <h3>A quick tip</h3>
          <p>
            With 20 dice on the table, roughly <strong>a third</strong> of them match any given number once
            wilds are counted — so about 6 or 7. Bidding a bit above that is normal pressure; bidding
            way above it is a bluff, and someone will eventually make you prove it.
          </p>
        </section>
      </div>

      <div className="rules-foot">
        <button type="button" onClick={onClose}>
          Got it
        </button>
      </div>
    </dialog>
  );
}
