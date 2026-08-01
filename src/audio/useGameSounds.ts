"use client";

import { useEffect, useRef } from "react";
import { useAudio } from "./AudioProvider";
import type { SoundName } from "./sfx";
import type { RoomSnapshot } from "../platform/roomTypes";

/**
 * Sound for every game, without touching a single game.
 *
 * Modules already emit typed events for their activity feed — "reveal",
 * "capture", "solved", "lynched" — so mapping those types to sounds gives all
 * thirteen games audio through one hook, and a new game gets it by emitting
 * the events it was going to emit anyway.
 *
 * Anything unmapped stays silent on purpose. A game that pings for everything
 * is exhausting, and silence is the correct default for an event nobody
 * decided to give a sound.
 */
const EVENT_SOUNDS: Record<string, SoundName> = {
  // Dice
  roll: "diceRoll",
  rolled: "diceRoll",
  dice: "diceRoll",
  // Cards and tiles
  play: "cardPlay",
  played: "cardPlay",
  draw: "cardDraw",
  drew: "cardDraw",
  deal: "shuffle",
  pickup: "cardDraw",
  tile: "tilePlace",
  domino: "tilePlace",
  // Board movement
  move: "pieceMove",
  moved: "pieceMove",
  capture: "pieceCapture",
  captured: "pieceCapture",
  knock: "pieceCapture",
  snake: "slideDown",
  ladder: "climbUp",
  home: "climbUp",
  // Betting
  bet: "chipBet",
  raise: "chipBet",
  call: "chipBet",
  fold: "turnPass",
  allIn: "chipBet",
  pot: "chipBet",
  // Information
  reveal: "reveal",
  clue: "clue",
  solved: "correct",
  correct: "correct",
  guess: "uiTap",
  vote: "uiTap",
  voted: "uiTap",
  accuse: "uiTap",
  hint: "reveal",
  question: "reveal",
  // Outcomes
  win: "win",
  challenge: "reveal",
  assassin: "lose",
  eliminated: "eliminate",
  lynched: "eliminate",
  died: "eliminate",
  timeout: "turnPass",
  endTurn: "turnPass",
  // Werewolf phases
  nightActed: "nightFall",
  phase: "dayBreak",
  hungry: "nightFall",
  matchOver: "win",
  turnOver: "reveal",
};

/**
 * Plays sound for a room's activity.
 *
 * Only events that arrived since the last snapshot are played, and a burst is
 * capped — a reconnect delivers the whole recent history at once, and firing
 * twenty sounds into someone's ears on rejoin is unforgivable.
 */
export function useGameSounds(snapshot: RoomSnapshot | null, playerId: string): void {
  const audio = useAudio();
  const lastCount = useRef(0);
  const lastPhase = useRef<string | null>(null);
  const wasMyTurn = useRef(false);
  const lastChat = useRef(0);

  // Game events.
  useEffect(() => {
    if (!snapshot) return;
    const events = snapshot.events ?? [];

    // A shorter list than last time means a new match reset it.
    if (events.length < lastCount.current) lastCount.current = 0;
    const fresh = events.slice(lastCount.current);
    lastCount.current = events.length;
    if (fresh.length === 0 || fresh.length > 6) return;

    const played = new Set<SoundName>();
    for (const event of fresh) {
      const sound = EVENT_SOUNDS[event.type];
      // One of each kind per batch: four captures in a chain is one sound.
      if (sound && !played.has(sound)) {
        played.add(sound);
        audio.play(sound);
      }
    }
  }, [snapshot, audio]);

  // Match start and finish.
  useEffect(() => {
    if (!snapshot) return;
    const phase = snapshot.phase;
    if (lastPhase.current === phase) return;
    const before = lastPhase.current;
    lastPhase.current = phase;
    if (before === null) return;

    if (phase === "playing") audio.play("start");
    if (phase === "finished") {
      const won = (snapshot.winners ?? []).includes(playerId);
      audio.play(won ? "win" : "lose");
    }
  }, [snapshot, audio, playerId]);

  // Your turn — the one cue people actually need when they have looked away.
  useEffect(() => {
    if (!snapshot || snapshot.phase !== "playing") {
      wasMyTurn.current = false;
      return;
    }
    const mine = snapshot.currentPlayerId === playerId;
    if (mine && !wasMyTurn.current) audio.play("yourTurn");
    wasMyTurn.current = mine;
  }, [snapshot, audio, playerId]);

  // Chat from other people.
  useEffect(() => {
    if (!snapshot) return;
    const chat = snapshot.chat ?? [];
    const newest = chat[chat.length - 1];
    if (!newest || newest.id === lastChat.current) return;
    const first = lastChat.current === 0;
    lastChat.current = newest.id;
    if (!first && newest.playerId && newest.playerId !== playerId) audio.play("chat");
  }, [snapshot, audio, playerId]);
}
