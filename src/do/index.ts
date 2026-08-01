/// <reference types="@cloudflare/workers-types" />
import { Env, RoomDO } from "./RoomDO";
import { AuthDO } from "./AuthDO";
import { RateLimiterDO, callerIp, checkIpLimit } from "./RateLimiterDO";
import { issueTicket, verifyIdentity, verifyTicket } from "../auth/tokens";
import { isValidRoomCode, mintRoomCode, normalizeRoomCode } from "../platform/roomCodes";
import type { IpLimitName } from "../platform/rateLimit";

export { RoomDO, AuthDO, RateLimiterDO };

/**
 * The front door.
 *
 * Everything that reaches a room passes through here, and here is where the
 * two questions that used to go unasked are answered: *who is this* (a signed
 * token, not a claimed id) and *are they going too fast* (a per-IP limiter).
 */

/**
 * Is this origin allowed to talk to the Worker?
 *
 * WebSocket upgrades are not subject to CORS, so without this any website
 * could point a client at this Worker and run their traffic through someone
 * else's account. Empty means "allow any", which is what local development
 * and a private test want.
 */
export function originAllowed(request: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (allowed.length === 0) return true;

  const origin = request.headers.get("Origin");
  // Non-browser clients — the integration scripts — send no Origin header.
  if (!origin) return true;
  return allowed.includes(origin.replace(/\/$/, ""));
}

function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !originAllowed(request, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const json = (body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...headers, ...(init.headers ?? {}) },
  });

/** The auth object holds the signing secret; one instance, named. */
const authStub = (env: Env) => env.AUTH.get(env.AUTH.idFromName("directory"));

/**
 * The HMAC secret, cached for the life of the isolate.
 *
 * Verifying a ticket must not cost a Durable Object round trip — that would
 * put a hop in front of every socket open — so the secret is fetched once and
 * kept in memory.
 */
let cachedSecret: string | null = null;
async function signingSecret(env: Env): Promise<string> {
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  if (cachedSecret) return cachedSecret;
  const response = await authStub(env).fetch("https://auth.internal/secret", { method: "POST" });
  const { secret } = (await response.json()) as { secret: string };
  return (cachedSecret = secret);
}

/** The identity behind an `Authorization: Bearer` header, if it is genuine. */
async function identityOf(request: Request, env: Env) {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  return verifyIdentity(token, await signingSecret(env));
}

/** Applies a per-IP limit, returning a 429 to send back when it bites. */
async function limited(request: Request, env: Env, name: IpLimitName): Promise<Response | null> {
  const verdict = await checkIpLimit(env.RATE_LIMITER, callerIp(request), name);
  if (verdict.allowed) return null;
  const seconds = Math.ceil(verdict.retryAfterMs / 1000);
  return json(
    { error: `Too many requests. Try again in ${seconds}s.`, retryAfterMs: verdict.retryAfterMs },
    { status: 429 },
    { "Retry-After": String(seconds) }
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = cors(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (url.pathname === "/health") {
      return json({ ok: true, service: "games-dome" }, {}, headers);
    }

    if (!originAllowed(request, env)) {
      return new Response("origin not allowed", { status: 403 });
    }

    // ---- identity ----
    if (url.pathname.startsWith("/auth/")) {
      const action = url.pathname.slice("/auth/".length);
      const limits: Record<string, IpLimitName | undefined> = {
        guest: "guest",
        register: "register",
        login: "login",
        // Anything that puts mail in someone's inbox.
        forgot: "email",
        "set-email": "email",
        "resend-verification": "email",
        // Following a link is not abuse, but it should not be unbounded either.
        reset: "consumeLink",
        verify: "consumeLink",
      };
      const limitName = limits[action];
      if (limitName) {
        const refusal = await limited(request, env, limitName);
        if (refusal) return new Response(refusal.body, { status: 429, headers: { ...headers, "content-type": "application/json" } });
      }
      /**
       * Reachable auth actions.
       *
       * "grant" is deliberately absent. It is what a completed payment will
       * call to hand over an item, and a client that could ask for it directly
       * would be a client that could award itself the whole catalogue.
       */
      const known = [
        "guest",
        "register",
        "login",
        "me",
        "rename",
        "forgot",
        "reset",
        "verify",
        "set-email",
        "resend-verification",
        "wardrobe",
        "equip",
      ];
      if (!known.includes(action)) {
        return json({ error: "not found" }, { status: 404 }, headers);
      }

      // `me` and `rename` authenticate with a header; forward it as a field so
      // the auth object has one shape to read.
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const bearer = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "").trim();
      const response = await authStub(env).fetch(`https://auth.internal/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, token: body.token ?? (bearer || undefined) }),
      });
      return new Response(response.body, { status: response.status, headers: { ...headers, "content-type": "application/json" } });
    }

    // ---- create a room ----
    if (url.pathname === "/rooms" && request.method === "POST") {
      const refusal = await limited(request, env, "createRoom");
      if (refusal) return new Response(refusal.body, { status: 429, headers: { ...headers, "content-type": "application/json" } });

      const me = await identityOf(request, env);
      if (!me) return json({ error: "sign in first" }, { status: 401 }, headers);

      // Retry on the (vanishingly unlikely) collision rather than handing
      // someone a room that already exists.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = mintRoomCode();
        const created = await env.ROOM.get(env.ROOM.idFromName(code)).fetch(
          "https://room.internal/__create",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code, ownerId: me.sub }),
          }
        );
        if (created.ok) return json({ code }, { status: 201 }, headers);
      }
      return json({ error: "could not create a room" }, { status: 500 }, headers);
    }

    // ---- ticket for one room ----
    const ticketRoute = url.pathname.match(/^\/rooms\/([A-Za-z0-9_-]+)\/ticket$/);
    if (ticketRoute && request.method === "POST") {
      const refusal = await limited(request, env, "ticket");
      if (refusal) return new Response(refusal.body, { status: 429, headers: { ...headers, "content-type": "application/json" } });

      const me = await identityOf(request, env);
      if (!me) return json({ error: "sign in first" }, { status: 401 }, headers);

      const code = normalizeRoomCode(ticketRoute[1]!);
      if (!isValidRoomCode(code)) return json({ error: "no such room" }, { status: 404 }, headers);

      const state = await env.ROOM.get(env.ROOM.idFromName(code)).fetch("https://room.internal/__exists");
      const room = (await state.json()) as { exists: boolean; locked: boolean };
      // A code that was never created and a code that does not exist give the
      // same answer, which is all an attacker enumerating codes ever sees.
      if (!room.exists) return json({ error: "no such room" }, { status: 404 }, headers);

      const body = (await request.json().catch(() => ({}))) as { name?: string };
      const name = String(body.name ?? me.name ?? "").slice(0, 16).trim() || me.name;
      const ticket = await issueTicket(
        { sub: me.sub, name, kind: me.kind, room: code },
        await signingSecret(env)
      );
      return json({ ticket, code, locked: room.locked }, {}, headers);
    }

    // ---- the room socket ----
    const socketRoute = url.pathname.match(/^\/room\/([A-Za-z0-9_-]+)$/);
    if (socketRoute) {
      const code = normalizeRoomCode(socketRoute[1]!);
      const ticket = url.searchParams.get("ticket") ?? "";
      const claims = await verifyTicket(ticket, code, await signingSecret(env));
      // No ticket, a ticket for a different room, or an expired one: the
      // player id can no longer simply be asserted by the client.
      if (!claims) return new Response("a valid room ticket is required", { status: 401 });

      const id = env.ROOM.idFromName(code);
      const forwarded = new URL(request.url);
      forwarded.pathname = `/room/${code}`;
      forwarded.search = `?playerId=${encodeURIComponent(claims.sub)}&name=${encodeURIComponent(claims.name)}`;
      return env.ROOM.get(id).fetch(new Request(forwarded.toString(), request));
    }

    return new Response("not found", { status: 404 });
  },
};
