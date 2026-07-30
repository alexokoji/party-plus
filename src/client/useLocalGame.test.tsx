// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLocalGame, BOT_THINK_MS, REVEAL_MS } from "./useLocalGame";

const PLAYERS = ["You", "Bot A", "Bot B"];

function setup(seed = 1) {
  return renderHook(() => useLocalGame({ playerNames: PLAYERS, viewerIndex: 0, seed }));
}

describe("useLocalGame", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("deals five dice to every player and shows only the viewer's faces", () => {
    const { result } = setup();
    expect(result.current.state.players).toHaveLength(3);
    for (const p of result.current.state.players) expect(p.diceCount).toBe(5);

    const mine = result.current.dice.filter((d) => d.ownerId === "You");
    const theirs = result.current.dice.filter((d) => d.ownerId !== "You");
    expect(mine).toHaveLength(5);
    expect(mine.every((d) => d.face !== null)).toBe(true);
    // The whole point: opponents' faces are withheld from the view model.
    expect(theirs.every((d) => d.face === null)).toBe(true);
  });

  it("starts on the viewer's turn and offers only legal bids", () => {
    const { result } = setup();
    expect(result.current.isViewerTurn).toBe(true);
    expect(result.current.legalBids.length).toBeGreaterThan(0);
    // No standing bid yet, so challenging is meaningless.
    expect(result.current.canChallenge).toBe(false);
  });

  it("hands the turn to the bots after the viewer bids, then gets it back", async () => {
    const { result } = setup();
    act(() => result.current.submitBid({ quantity: 2, face: 3 }));
    expect(result.current.isViewerTurn).toBe(false);
    expect(result.current.state.currentBid).toEqual({ quantity: 2, face: 3 });

    // Let both bots take their turns.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOT_THINK_MS * 2 + 200);
    });
    await waitFor(() => {
      expect(
        result.current.isViewerTurn || result.current.reveal !== null || result.current.state.phase === "gameOver"
      ).toBe(true);
    });
  });

  it("rejects an illegal bid without advancing the turn", () => {
    const { result } = setup();
    act(() => result.current.submitBid({ quantity: 2, face: 3 }));
    const roundBefore = result.current.state.round;
    // Going backwards is illegal; the engine must refuse it.
    act(() => result.current.submitBid({ quantity: 1, face: 2 }));
    expect(result.current.error).toBeTruthy();
    expect(result.current.state.round).toBe(roundBefore);
  });

  it("logs each action exactly once (no StrictMode double-entry)", async () => {
    const { result } = setup();
    act(() => result.current.submitBid({ quantity: 2, face: 3 }));

    const bidEntries = result.current.log.filter((e) => e.kind === "bid" && e.playerId === "You");
    expect(bidEntries).toHaveLength(1);

    // Round headers must not duplicate either.
    const roundOne = result.current.log.filter((e) => e.kind === "round" && e.text.includes("Round 1"));
    expect(roundOne).toHaveLength(1);
  });

  it("reveals every hand when a challenge resolves, then resumes", async () => {
    const { result } = setup();
    act(() => result.current.submitBid({ quantity: 1, face: 2 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOT_THINK_MS * 3 + 300);
    });

    // Drive a challenge from whoever the viewer is, once it is their turn.
    if (result.current.isViewerTurn && result.current.canChallenge) {
      act(() => result.current.submitChallenge());
      expect(result.current.reveal).not.toBeNull();
      // During a reveal every hand is visible, including opponents'.
      expect(result.current.dice.every((d) => d.face !== null)).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(REVEAL_MS + 200);
      });
      expect(result.current.reveal).toBeNull();
    }
  });

  it("removes exactly one die from play per challenge", async () => {
    const { result } = setup(7);
    const totalBefore = result.current.state.players.reduce((s, p) => s + p.diceCount, 0);

    act(() => result.current.submitBid({ quantity: 1, face: 2 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOT_THINK_MS * 3 + 300);
    });
    if (result.current.isViewerTurn && result.current.canChallenge) {
      act(() => result.current.submitChallenge());
      const totalAfter = result.current.state.players.reduce((s, p) => s + p.diceCount, 0);
      expect(totalAfter).toBe(totalBefore - 1);
    }
  });

  it("restart deals a fresh match and clears the feed", async () => {
    const { result } = setup();
    act(() => result.current.submitBid({ quantity: 2, face: 3 }));
    expect(result.current.state.currentBid).not.toBeNull();

    act(() => result.current.restart());
    expect(result.current.state.currentBid).toBeNull();
    expect(result.current.state.round).toBe(1);
    expect(result.current.state.players.every((p) => p.diceCount === 5)).toBe(true);
    expect(result.current.log.filter((e) => e.kind === "bid")).toHaveLength(0);
  });

  it("never lets the viewer act out of turn", async () => {
    const { result } = setup();
    act(() => result.current.submitBid({ quantity: 2, face: 3 }));
    // It is now a bot's turn; the viewer's controls must be closed.
    expect(result.current.isViewerTurn).toBe(false);
    expect(result.current.legalBids).toHaveLength(0);
    expect(result.current.canChallenge).toBe(false);
  });
});
