"use client";

import { useEffect, useState } from "react";
import { ROLES, type RoleId } from "./rules";
import type { WerewolfMove, WerewolfPlayerView } from "./module";

export interface WerewolfViewProps {
  view: WerewolfPlayerView;
  playerId: string;
  isMyTurn: boolean;
  isPlaying: boolean;
  nameOf: (id: string) => string;
  onMove: (move: WerewolfMove) => void;
}

const PHASE_LABEL: Record<WerewolfPlayerView["phase"], string> = {
  night: "🌙 Night",
  day: "☀️ Day — discuss",
  vote: "🗳️ Vote",
  over: "Finished",
};

const ROLE_ICON: Record<RoleId, string> = {
  villager: "🧑‍🌾",
  werewolf: "🐺",
  seer: "🔮",
  doctor: "⚕️",
  hunter: "🏹",
  witch: "🧪",
};

/**
 * Werewolf renderer.
 *
 * The module already strips every role the recipient is not entitled to, so
 * this component simply draws what it is given — there is no branch here that
 * could reveal a role the server withheld, including for the dead.
 */
export function WerewolfView({ view, playerId, isMyTurn, isPlaying, nameOf, onMove }: WerewolfViewProps) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  // The phase clock lives in the module; this just counts down to its deadline.
  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((view.phaseEndsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [view.phaseEndsAt]);

  const me = view.me;
  const targets = new Set(view.targets);
  const knownWolf = new Map(me?.knowledge.map((k) => [k.playerId, k.isWolf]) ?? []);
  const allies = new Set(me?.allies ?? []);

  function actOn(targetId: string) {
    if (!view.canAct || !targets.has(targetId)) return;
    if (view.phase === "night") return onMove({ type: "nightAction", targetId });
    if (view.phase === "day") return onMove({ type: "accuse", targetId });
    if (view.phase === "vote") return onMove({ type: "vote", targetId });
  }

  const actionHint = () => {
    if (!me) return "You are watching the village.";
    if (!me.alive) return "You are dead. You can watch, but you cannot act — or vote.";
    if (view.finished) return "The night is over.";
    if (view.phase === "night") {
      if (!ROLES[me.role].actsAtNight) return "Sleep tight. Those with powers are moving.";
      if (me.nightChoice) return "Your choice is locked in. Waiting on the others…";
      if (me.role === "werewolf") return "Choose who the pack eats.";
      if (me.role === "seer") return "Choose someone to inspect.";
      if (me.role === "doctor") return "Choose someone to protect.";
      return "Choose your target.";
    }
    if (view.phase === "day") return "Accuse whoever you suspect — accusations are public, and free to change.";
    if (view.phase === "vote") {
      return me.vote === undefined ? "Cast your vote, or abstain." : "Vote cast. Waiting on the rest…";
    }
    return "";
  };

  return (
    <>
      <div className="status-bar card-panel">
        <p className="status-line">
          <strong>{PHASE_LABEL[view.phase]}</strong>
          <span className="whot-demand">round {view.round}</span>
          {!view.finished && (
            <span className={`whot-debt${secondsLeft <= 10 ? " urgent" : ""}`}>{secondsLeft}s left</span>
          )}
          {view.finished && (
            <span className="whot-demand">
              {view.winningTeam === "wolves" ? "🐺 the wolves win" : "🧑‍🌾 the village wins"}
            </span>
          )}
        </p>
        <span className="whot-rules-badge">{view.rulesName}</span>
      </div>

      {me && (
        <div className={`card-panel role-card team-${me.team}${me.alive ? "" : " dead"}`}>
          <span className="role-icon">{ROLE_ICON[me.role]}</span>
          <div>
            <h3>
              You are the {me.roleName}
              {!me.alive && " (dead)"}
            </h3>
            <p>{me.description}</p>
            {allies.size > 0 && (
              <p className="role-allies">
                Your pack: {[...allies].map(nameOf).join(", ")}
              </p>
            )}
            {me.potions && (
              <p className="role-allies">
                Potions — heal: {me.potions.heal ? "unused" : "spent"}, poison:{" "}
                {me.potions.poison ? "unused" : "spent"}
              </p>
            )}
          </div>
        </div>
      )}

      <p className="hint action-hint">{actionHint()}</p>

      <div className="card-panel village-grid">
        {view.players.map((p) => {
          const isMe = p.id === playerId;
          const selectable = view.canAct && targets.has(p.id) && isPlaying;
          const revealed = view.revealedRoles?.[p.id];
          const seen = knownWolf.get(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={[
                "villager-card",
                p.alive ? "alive" : "dead",
                isMe ? "me" : "",
                selectable ? "selectable" : "",
                me?.nightChoice === p.id ? "chosen" : "",
                me?.vote === p.id ? "chosen" : "",
                allies.has(p.id) ? "ally" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={!selectable}
              onClick={() => actOn(p.id)}
            >
              <span className="villager-name">
                {nameOf(p.id)}
                {isMe && " (you)"}
              </span>
              <span className="villager-state">{p.alive ? "alive" : "☠ dead"}</span>
              {seen !== undefined && (
                <span className="villager-seen">{seen ? "🐺 wolf" : "✓ not a wolf"}</span>
              )}
              {allies.has(p.id) && <span className="villager-seen">🐺 your pack</span>}
              {revealed && (
                <span className="villager-role">
                  {ROLE_ICON[revealed]} {ROLES[revealed].name}
                </span>
              )}
              {view.phase === "vote" && p.hasVoted && <span className="villager-vote">voted</span>}
              {view.phase === "day" && p.accusedBy.length > 0 && (
                <span className="villager-vote">
                  accused by {p.accusedBy.map(nameOf).join(", ")}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isPlaying && me?.alive && view.phase === "vote" && me.vote === undefined && (
        <div className="table-actions">
          <button type="button" onClick={() => onMove({ type: "vote", targetId: null })}>
            Abstain
          </button>
        </div>
      )}

      {!isPlaying && <p className="spectator-note">👀 Spectating — roles stay hidden until the game ends.</p>}

      <div className="card-panel">
        <h3 className="hand-heading">Roles in play</h3>
        <ul className="role-list">
          {view.rolesInPlay.map((role) => (
            <li key={role}>
              {ROLE_ICON[role]} {ROLES[role].name}
            </li>
          ))}
        </ul>
      </div>

      {view.history.length > 0 && (
        <div className="card-panel">
          <h3 className="hand-heading">What happened</h3>
          <ol className="round-history">
            {view.history.map((r) => (
              <li key={r.round}>
                <strong>Round {r.round}</strong>
                {r.killedAtNight.length > 0
                  ? ` — ${r.killedAtNight.map(nameOf).join(", ")} died in the night`
                  : " — nobody died in the night"}
                {r.savedAtNight.length > 0 && ` (${r.savedAtNight.map(nameOf).join(", ")} was saved)`}
                {r.lynched ? `; the village voted out ${nameOf(r.lynched)}` : "; no lynch"}
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
