import { describe, it, expect } from "vitest";
import {
  consume,
  IP_LIMITS,
  limitNameFor,
  newBucket,
  perWindow,
  SocketLimiter,
  SOCKET_LIMITS,
  type Bucket,
} from "./rateLimit";

const NOW = 1_700_000_000_000;
const limit = perWindow(5, 10); // 5 per 10 seconds

describe("token bucket", () => {
  it("allows a burst up to capacity, then refuses", () => {
    let bucket: Bucket | undefined;
    for (let i = 0; i < 5; i++) {
      const result = consume(bucket, limit, NOW);
      expect(result.allowed, `call ${i}`).toBe(true);
      bucket = result.bucket;
    }
    const blocked = consume(bucket, limit, NOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills over time rather than resetting on a boundary", () => {
    let bucket = newBucket(limit, NOW);
    for (let i = 0; i < 5; i++) bucket = consume(bucket, limit, NOW).bucket;
    expect(consume(bucket, limit, NOW).allowed).toBe(false);
    // One token per two seconds at this rate.
    expect(consume(bucket, limit, NOW + 1000).allowed).toBe(false);
    expect(consume(bucket, limit, NOW + 2000).allowed).toBe(true);
  });

  it("never refills past capacity, however long the wait", () => {
    const bucket = consume(newBucket(limit, NOW), limit, NOW).bucket;
    const after = consume(bucket, limit, NOW + 86_400_000);
    expect(after.remaining).toBe(limit.capacity - 1);
  });

  it("cannot be gamed by a bucket claiming to be from the future", () => {
    // Time going backwards must not mint tokens.
    const drained: Bucket = { tokens: 0, updatedAt: NOW + 60_000 };
    expect(consume(drained, limit, NOW).allowed).toBe(false);
  });

  it("reports a sane retry hint", () => {
    const drained: Bucket = { tokens: 0, updatedAt: NOW };
    // 0.5 tokens/sec, so one token is 2s away.
    expect(consume(drained, limit, NOW).retryAfterMs).toBe(2000);
  });

  it("supports a cost above one", () => {
    const result = consume(newBucket(limit, NOW), limit, NOW, 5);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
    expect(consume(result.bucket, limit, NOW, 1).allowed).toBe(false);
  });
});

describe("per-IP limits", () => {
  it("makes guessing room codes expensive", () => {
    // The ticket endpoint is the only oracle for "does this code exist", so it
    // is what an attacker enumerating codes has to go through.
    const perHour = IP_LIMITS.ticket.refillPerSecond * 3600;
    expect(perHour).toBeLessThan(500);
    // 32^8 codes against a few hundred tries an hour is not a search anyone
    // finishes.
    expect(32 ** 8 / perHour).toBeGreaterThan(1e9);
  });

  it("keeps registration and login tight", () => {
    expect(IP_LIMITS.register.capacity).toBeLessThanOrEqual(5);
    expect(IP_LIMITS.login.refillPerSecond * 3600).toBeLessThan(100);
  });
});

describe("socket limits", () => {
  it("allows drawing to be drawing", () => {
    // A pointer trail is dozens of frames a second; a limit below that would
    // make the canvas stutter for the drawer.
    expect(SOCKET_LIMITS.stream.refillPerSecond).toBeGreaterThanOrEqual(50);
  });

  it("keeps chat modest and moves bounded", () => {
    expect(SOCKET_LIMITS.chat.capacity).toBeLessThanOrEqual(10);
    expect(SOCKET_LIMITS.move.capacity).toBeLessThanOrEqual(100);
  });

  it("allows a frantic guesser, whose guesses are moves", () => {
    // Typing guesses at a drawing is bursty and fast; refusing that would look
    // like the game ignoring you at the worst moment.
    const limiter = new SocketLimiter();
    let allowed = 0;
    for (let i = 0; i < 20; i++) {
      if (limiter.check("move", NOW + i * 300).allowed) allowed++;
    }
    expect(allowed).toBe(20);
  });

  it("routes each message type to its own bucket", () => {
    expect(limitNameFor("stream")).toBe("stream");
    expect(limitNameFor("move")).toBe("move");
    expect(limitNameFor("chat")).toBe("chat");
    expect(limitNameFor("emote")).toBe("chat");
    expect(limitNameFor("setName")).toBe("other");
    expect(limitNameFor("anything-unknown")).toBe("other");
  });

  it("does not let chat spam eat the move allowance", () => {
    const limiter = new SocketLimiter();
    for (let i = 0; i < 50; i++) limiter.check("chat", NOW);
    expect(limiter.check("chat", NOW).allowed).toBe(false);
    expect(limiter.check("move", NOW).allowed).toBe(true);
  });

  it("allows a normal fast player", () => {
    const limiter = new SocketLimiter();
    // Five moves a second for two seconds — quick, but human.
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      if (limiter.check("move", NOW + i * 200).allowed) allowed++;
    }
    expect(allowed).toBe(10);
  });

  it("flags a caller that keeps hammering after being refused", () => {
    const limiter = new SocketLimiter();
    for (let i = 0; i < 100; i++) limiter.check("chat", NOW);
    expect(limiter.abusive).toBe(true);
  });

  it("forgives someone who backs off", () => {
    const limiter = new SocketLimiter();
    for (let i = 0; i < 100; i++) limiter.check("chat", NOW);
    expect(limiter.abusive).toBe(true);
    // A single successful call clears the streak.
    expect(limiter.check("chat", NOW + 60_000).allowed).toBe(true);
    expect(limiter.abusive).toBe(false);
  });
});
