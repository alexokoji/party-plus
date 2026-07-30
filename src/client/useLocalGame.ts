"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyAction, createGame, InvalidActionError, isValidBidTransition } from "../engine/game";
import { chooseAction, type Difficulty } from "../engine/ai";
import type { Bid, Face, GameState, RoundResult } from "../engine/types";
import type { DieView } from "../animation/types";

/** How long the table stays frozen on a revealed challenge before the next round. */
export const REVEAL_MS = 3200;
/** Pause before a bot acts, so turns are readable rather than instant. */
export const BOT_THINK_MS = 900;

export interface LocalGameOptions {
  playerNames: string[];
  /** Index in playerNames controlled by the human. */
  viewerIndex?: number;
  seed?: number;
  difficulty?: Difficulty;
}

export interface LogEntry {
  id: number;
  playerId: string;
  kind: "bid" | "challenge" | "result" | "eliminated" | "round";
  text: string;
}

export interface LocalGame {
  state: GameState;
  viewerId: string;
  /** Dice as this client is entitled to see them — opponents' faces are null. */
  dice: DieView[];
  rollSeed: number;
  /** Non-null while a resolved challenge is being shown with all hands revealed. */
  reveal: RoundResult | null;
  isViewerTurn: boolean;
  viewerEliminated: boolean;
  legalBids: Bid[];
  canChallenge: boolean;
  error: string | null;
  /** Newest-last feed of what everyone did, so bot turns are visible. */
  log: LogEntry[];
  /** Id of the bot currently deciding, for a "thinking" indicator. */
  thinkingPlayerId: string | null;
  submitBid: (bid: Bid) => void;
  submitChallenge: () => void;
  restart: () => void;
}

/**
 * Drives a full match against AI opponents on the client.
 *
 * The rules engine stays the single source of truth: every move — human or
 * bot — goes through applyAction, so the local game cannot diverge from what
 * the room Durable Object would do with the same inputs. The AI only ever
 * reads its own hand (see chooseAction), so it is not cheating off state the
 * viewer cannot see.
 */
export function useLocalGame({
  playerNames,
  viewerIndex = 0,
  seed,
  difficulty = "sharp",
}: LocalGameOptions): LocalGame {
  const [gameSeed, setGameSeed] = useState(() => seed ?? Math.floor(Math.random() * 1e9));
  const [state, setState] = useState<GameState>(() => createGame(playerNames, gameSeed));
  /** Mirrors `state` synchronously so commits never read a stale value. */
  const stateRef = useRef(state);
  const [reveal, setReveal] = useState<RoundResult | null>(null);
  const [rollSeed, setRollSeed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [thinkingPlayerId, setThinkingPlayerId] = useState<string | null>(null);
  const logId = useRef(0);
  const announcedRound = useRef(-1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const pushLog = useCallback((entry: Omit<LogEntry, "id">) => {
    setLog((current) => [...current, { ...entry, id: logId.current++ }].slice(-40));
  }, []);

  const viewerId = playerNames[viewerIndex]!;

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /**
   * Applies an action and records what happened.
   *
   * Everything here runs *outside* the setState updater on purpose. React may
   * invoke an updater more than once for the same update (StrictMode does so
   * deliberately in development), so logging from inside one duplicates every
   * entry. `stateRef` is updated synchronously so two commits in the same tick
   * — a human click landing alongside a bot timer — still compose correctly.
   */
  const commit = useCallback(
    (action: Parameters<typeof applyAction>[1]) => {
      const current = stateRef.current;
      let next: GameState;
      try {
        next = applyAction(current, action);
      } catch (err) {
        if (err instanceof InvalidActionError) {
          setError(err.message);
          return;
        }
        throw err;
      }

      stateRef.current = next;
      setState(next);
      setError(null);
      setRollSeed((s) => s + 1);

      if (action.type === "bid") {
        pushLog({
          playerId: action.playerId,
          kind: "bid",
          text: `${action.playerId} bids ${action.bid.quantity} × ${action.bid.face}`,
        });
        return;
      }

      // Freeze on the reveal: the RoundResult carries every hand as it stood
      // when the challenge landed, which the engine has already rerolled past.
      const result = next.history[next.history.length - 1] ?? null;
      setReveal(result);
      if (!result) return;

      pushLog({
        playerId: action.playerId,
        kind: "challenge",
        text: `${result.challengerId} calls bluff on ${result.bidderId}`,
      });
      pushLog({
        playerId: result.loserId,
        kind: "result",
        text: `There were ${result.actualCount} — ${result.loserId} loses a die`,
      });
      const loser = next.players.find((p) => p.id === result.loserId);
      if (loser?.eliminated) {
        pushLog({ playerId: loser.id, kind: "eliminated", text: `${loser.id} is out!` });
      }
    },
    [pushLog]
  );

  // Clear the reveal after a beat so play resumes on the already-advanced state.
  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => {
      setReveal(null);
      setRollSeed((s) => s + 1);
    }, REVEAL_MS);
    timers.current.push(timer);
    return () => clearTimeout(timer);
  }, [reveal]);

  const currentPlayer = state.players[state.currentPlayerIndex];
  const isViewerTurn =
    state.phase === "bidding" && !reveal && currentPlayer?.id === viewerId && !currentPlayer?.eliminated;

  // Bot turns. The deliberate pause is what makes opponents feel present —
  // without it their whole turn cycle resolves between two paints and the
  // game looks like nobody else is playing.
  useEffect(() => {
    if (state.phase === "gameOver" || reveal) {
      setThinkingPlayerId(null);
      return;
    }
    const actor = state.players[state.currentPlayerIndex];
    if (!actor || actor.id === viewerId || actor.eliminated) {
      setThinkingPlayerId(null);
      return;
    }

    setThinkingPlayerId(actor.id);
    const timer = setTimeout(() => {
      setThinkingPlayerId(null);
      commit(chooseAction(state, actor.id, Math.random, difficulty));
    }, BOT_THINK_MS);
    timers.current.push(timer);
    return () => clearTimeout(timer);
  }, [state, reveal, viewerId, difficulty, commit]);

  // Announce each new round so the feed doesn't run rounds together. Guarded
  // by a ref because StrictMode re-runs effects, which would double-announce.
  useEffect(() => {
    if (state.phase !== "bidding") return;
    if (announcedRound.current === state.round) return;
    announcedRound.current = state.round;
    pushLog({
      playerId: "",
      kind: "round",
      text: state.palifico ? `Round ${state.round} — PALIFICO` : `Round ${state.round}`,
    });
  }, [state.round, state.phase, state.palifico, pushLog]);

  const dice: DieView[] = useMemo(() => {
    // While revealing, show the hands exactly as they were at the challenge.
    if (reveal) {
      return Object.entries(reveal.allHands).flatMap(([ownerId, hand]) =>
        hand.map((face, i) => ({ id: `${ownerId}-${i}`, ownerId, face }))
      );
    }
    return state.players
      .filter((p) => !p.eliminated)
      .flatMap((p) =>
        p.dice.map((face, i) => ({
          id: `${p.id}-${i}`,
          ownerId: p.id,
          // Eliminated viewers become spectators and may see everything.
          face: p.id === viewerId || viewerIsSpectator(state, viewerId) ? face : null,
        }))
      );
  }, [state, reveal, viewerId]);

  const legalBids = useMemo(() => {
    if (!isViewerTurn) return [];
    const totalDice = state.players.reduce((sum, p) => sum + p.diceCount, 0);
    const bids: Bid[] = [];
    for (let quantity = 1; quantity <= totalDice; quantity++) {
      for (const face of [1, 2, 3, 4, 5, 6] as Face[]) {
        const bid = { quantity, face };
        if (isValidBidTransition(state.currentBid, bid, state.palifico)) bids.push(bid);
      }
    }
    return bids;
  }, [state, isViewerTurn]);

  const restart = useCallback(() => {
    clearTimers();
    const nextSeed = Math.floor(Math.random() * 1e9);
    const fresh = createGame(playerNames, nextSeed);
    setGameSeed(nextSeed);
    stateRef.current = fresh;
    announcedRound.current = -1;
    setState(fresh);
    setReveal(null);
    setError(null);
    setLog([]);
    setThinkingPlayerId(null);
    setRollSeed((s) => s + 1);
  }, [playerNames, clearTimers]);

  return {
    state,
    viewerId,
    dice,
    rollSeed,
    reveal,
    isViewerTurn: !!isViewerTurn,
    viewerEliminated: viewerIsSpectator(state, viewerId),
    legalBids,
    canChallenge: !!isViewerTurn && state.currentBid !== null,
    error,
    log,
    thinkingPlayerId,
    submitBid: (bid) => commit({ type: "bid", playerId: viewerId, bid }),
    submitChallenge: () => commit({ type: "challenge", playerId: viewerId }),
    restart,
  };
}

function viewerIsSpectator(state: GameState, viewerId: string): boolean {
  return state.players.find((p) => p.id === viewerId)?.eliminated ?? false;
}
