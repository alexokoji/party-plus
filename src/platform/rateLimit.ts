/**
 * Token-bucket rate limiting.
 *
 * Pure and serialisable so the same implementation covers both places it is
 * needed: per-IP limits held in a Durable Object, and per-connection limits
 * held in memory inside a room. A bucket refills continuously rather than
 * resetting on a window boundary, which avoids the burst-at-the-boundary
 * behaviour of fixed windows.
 */

export interface Bucket {
  /** Tokens available at `updatedAt`, fractional. */
  tokens: number;
  updatedAt: number;
}

export interface Limit {
  /** Maximum tokens, and therefore the largest burst allowed. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

export interface LimitResult {
  allowed: boolean;
  bucket: Bucket;
  /** Whole tokens left after this call. */
  remaining: number;
  /** Ms until one token is available, 0 when allowed. */
  retryAfterMs: number;
}

export function newBucket(limit: Limit, now: number): Bucket {
  return { tokens: limit.capacity, updatedAt: now };
}

/**
 * Spends one token if there is one.
 *
 * Callers keep the returned bucket. Time going backwards (clock adjustment,
 * or a stored bucket from the future) is clamped rather than trusted, so it
 * cannot mint tokens.
 */
export function consume(bucket: Bucket | undefined, limit: Limit, now: number, cost = 1): LimitResult {
  const current = bucket ?? newBucket(limit, now);
  const elapsedMs = Math.max(0, now - current.updatedAt);
  const tokens = Math.min(limit.capacity, current.tokens + (elapsedMs / 1000) * limit.refillPerSecond);

  if (tokens < cost) {
    const deficit = cost - tokens;
    const retryAfterMs = Math.ceil((deficit / limit.refillPerSecond) * 1000);
    return {
      allowed: false,
      bucket: { tokens, updatedAt: now },
      remaining: Math.floor(tokens),
      retryAfterMs,
    };
  }

  return {
    allowed: true,
    bucket: { tokens: tokens - cost, updatedAt: now },
    remaining: Math.floor(tokens - cost),
    retryAfterMs: 0,
  };
}

/** Per-second rate from a friendlier "N per window" description. */
export const perWindow = (count: number, windowSeconds: number): Limit => ({
  capacity: count,
  refillPerSecond: count / windowSeconds,
});

/**
 * Limits for the endpoints that can be abused from outside, keyed by IP.
 *
 * `ticket` is the important one: it is the only way to find out whether a room
 * code exists, so it is what an attacker guessing codes has to go through.
 */
export const IP_LIMITS = {
  guest: perWindow(15, 600),
  register: perWindow(5, 3600),
  login: perWindow(10, 600),
  createRoom: perWindow(20, 3600),
  ticket: perWindow(40, 600),
  /**
   * Anything that causes an email to be sent.
   *
   * Tight, because the cost of getting this wrong is landing in someone's
   * inbox repeatedly — which is both abuse of them and the fastest way to
   * have a sending domain marked as spam.
   */
  email: perWindow(5, 3600),
  /** Consuming a link: generous, since honest people click twice. */
  consumeLink: perWindow(20, 600),
} as const satisfies Record<string, Limit>;

export type IpLimitName = keyof typeof IP_LIMITS;

/**
 * Limits for messages on an open socket, held per connection.
 *
 * Drawing needs a big allowance — a pointer trail is dozens of frames a second
 * — while chat needs a small one. Moves sit in between: generous enough for
 * fast play and the integration scripts, tight enough that a loop cannot melt
 * a room.
 */
export const SOCKET_LIMITS = {
  chat: perWindow(8, 10),
  // 6 a second sustained, 60 in a burst. Tighter than this refused honest
  // play: a guess in Sketch & Guess is a move, and people type guesses
  // frantically while a drawing is being finished.
  move: perWindow(60, 10),
  stream: perWindow(240, 4),
  other: perWindow(30, 10),
} as const satisfies Record<string, Limit>;

export type SocketLimitName = keyof typeof SOCKET_LIMITS;

/** Which limit a client message counts against. */
export function limitNameFor(type: string): SocketLimitName {
  if (type === "stream") return "stream";
  if (type === "move") return "move";
  if (type === "chat" || type === "emote") return "chat";
  return "other";
}

/**
 * Per-connection limiter.
 *
 * In-memory on purpose: it lives exactly as long as the socket does, needs no
 * storage write on the hot path, and a reconnect getting a fresh allowance is
 * fine because reconnects are themselves rate limited at the ticket endpoint.
 */
export class SocketLimiter {
  private buckets = new Map<string, Bucket>();
  /** Consecutive refusals, for deciding when someone is not merely fast. */
  private strikes = 0;

  check(name: SocketLimitName, now = Date.now()): LimitResult {
    const result = consume(this.buckets.get(name), SOCKET_LIMITS[name], now);
    this.buckets.set(name, result.bucket);
    this.strikes = result.allowed ? 0 : this.strikes + 1;
    return result;
  }

  /** True once the pattern looks automated rather than enthusiastic. */
  get abusive(): boolean {
    return this.strikes >= 20;
  }
}
