/// <reference types="@cloudflare/workers-types" />
import { consume, IP_LIMITS, type Bucket, type IpLimitName } from "../platform/rateLimit";

/**
 * Per-IP rate limiting.
 *
 * One instance per caller (the IP is the DO name), so the buckets for one
 * address are always read and written in one place with no races. This costs a
 * round trip, which is why it guards only the endpoints that can be abused
 * from outside — never the message path of an open socket, which does its
 * limiting in memory inside the room.
 */
export class RateLimiterDO {
  private storage: DurableObjectStorage;
  private buckets = new Map<string, Bucket>();

  constructor(ctx: DurableObjectState) {
    this.storage = ctx.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const name = url.searchParams.get("limit") as IpLimitName | null;
    const limit = name ? IP_LIMITS[name] : undefined;
    if (!limit) return Response.json({ allowed: false, error: "unknown limit" }, { status: 400 });

    const now = Date.now();
    const key = `bucket:${name}`;
    const current = this.buckets.get(key) ?? (await this.storage.get<Bucket>(key));
    const result = consume(current, limit, now);

    this.buckets.set(key, result.bucket);
    // Persisted so a restart does not hand out a fresh allowance, but written
    // without awaiting: losing the last write costs one extra request, and
    // waiting on it would put storage latency in front of every call.
    void this.storage.put(key, result.bucket);

    // Buckets that have refilled to full carry no information; dropping them
    // keeps an idle limiter from accumulating storage for every passing IP.
    if (result.bucket.tokens >= limit.capacity - 0.001) {
      this.buckets.delete(key);
      void this.storage.delete(key);
    }

    return Response.json({
      allowed: result.allowed,
      remaining: result.remaining,
      retryAfterMs: result.retryAfterMs,
    });
  }
}

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Asks the limiter for this caller.
 *
 * Fails OPEN: if the limiter itself is unavailable the request proceeds. A
 * rate limiter that takes the site down when it breaks is a worse outage than
 * the abuse it prevents, and the abuse is bounded by everything else.
 */
export async function checkIpLimit(
  namespace: DurableObjectNamespace,
  ip: string,
  name: IpLimitName
): Promise<RateLimitVerdict> {
  try {
    const id = namespace.idFromName(`ip:${ip}`);
    const response = await namespace
      .get(id)
      .fetch(`https://limiter.internal/check?limit=${encodeURIComponent(name)}`);
    if (!response.ok) return { allowed: true, retryAfterMs: 0 };
    const body = (await response.json()) as RateLimitVerdict;
    return { allowed: !!body.allowed, retryAfterMs: body.retryAfterMs ?? 0 };
  } catch {
    return { allowed: true, retryAfterMs: 0 };
  }
}

/**
 * The caller's address.
 *
 * `CF-Connecting-IP` is set by Cloudflare's edge and cannot be spoofed by the
 * client — unlike `X-Forwarded-For`, which is why that one is not consulted.
 * Local development has neither, so everything shares one bucket there.
 */
export function callerIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}
