/**
 * Signed identity tokens and room tickets.
 *
 * The platform's whole hidden-information design assumed the server knew who
 * it was talking to. It did not: the player id arrived as a query parameter
 * and was believed. Anyone who learned your id could connect as you and be
 * handed your dice, your hand, your role — the redaction was correct and
 * pointed at the wrong person.
 *
 * A token is `base64url(payload).base64url(HMAC-SHA256(payload))`. Compact,
 * stateless to verify, and no dependencies — Web Crypto is available in
 * Workers and in Node 18+, so the same code runs in tests.
 *
 * Deliberately NOT a general JWT implementation: there is one algorithm and no
 * `alg` field to confuse, which removes the entire family of "alg: none" and
 * algorithm-substitution attacks.
 */

export type TokenKind = "guest" | "user";

export interface IdentityClaims {
  /** Stable player id. Guests get one too — it is just not recoverable. */
  sub: string;
  /** Display name at issue time. The room may still rename them. */
  name: string;
  kind: TokenKind;
  /**
   * Password version at issue time, for accounts.
   *
   * Tokens are stateless and last a month, so a password reset would otherwise
   * leave every existing session alive — including the intruder's, which is
   * usually the exact reason someone is resetting. The auth object bumps this
   * on every password change, and a token carrying a stale value is refused.
   * Guests have no password and no version, so they need no lookup.
   */
  pv?: number;
  /** Issued at, epoch ms. */
  iat: number;
  /** Expires at, epoch ms. */
  exp: number;
}

/**
 * A ticket authorises ONE room, briefly.
 *
 * Browsers cannot set headers on a WebSocket handshake, so whatever
 * authenticates the socket has to travel in the URL — and URLs end up in
 * server logs. A ticket keeps the long-lived identity token out of them: it is
 * scoped to a single room, lives about a minute, and is worthless afterwards.
 */
export interface TicketClaims {
  sub: string;
  name: string;
  kind: TokenKind;
  /** Room code this ticket is good for, and no other. */
  room: string;
  iat: number;
  exp: number;
}

export const IDENTITY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const TICKET_TTL_MS = 90 * 1000;

const encoder = new TextEncoder();

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Length-independent comparison, so a mismatch leaks no timing signal. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function sign(payload: unknown, secret: string): Promise<string> {
  const body = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${base64urlEncode(sig)}`;
}

async function verify<T>(token: string, secret: string, now: number): Promise<T | null> {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  // Exactly one separator: a second one would mean a different format.
  if (dot <= 0 || token.indexOf(".", dot + 1) !== -1) return null;

  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  let signature: Uint8Array;
  let payloadBytes: Uint8Array;
  try {
    signature = base64urlDecode(provided);
    payloadBytes = base64urlDecode(body);
  } catch {
    return null;
  }

  const key = await hmacKey(secret);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  if (!timingSafeEqual(signature, expected)) return null;

  let claims: T & { exp?: number };
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  // An unsigned expiry would be pointless; this one is inside the signature.
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  return claims;
}

export async function issueIdentity(
  claims: { sub: string; name: string; kind: TokenKind; pv?: number },
  secret: string,
  now = Date.now(),
  ttlMs = IDENTITY_TTL_MS
): Promise<string> {
  return sign({ ...claims, iat: now, exp: now + ttlMs } satisfies IdentityClaims, secret);
}

export async function verifyIdentity(
  token: string,
  secret: string,
  now = Date.now()
): Promise<IdentityClaims | null> {
  const claims = await verify<IdentityClaims>(token, secret, now);
  if (!claims) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  if (claims.kind !== "guest" && claims.kind !== "user") return null;
  return claims;
}

export async function issueTicket(
  claims: { sub: string; name: string; kind: TokenKind; room: string },
  secret: string,
  now = Date.now(),
  ttlMs = TICKET_TTL_MS
): Promise<string> {
  return sign({ ...claims, iat: now, exp: now + ttlMs } satisfies TicketClaims, secret);
}

/**
 * Verifies a ticket for a specific room.
 *
 * The room is checked here rather than by the caller: a ticket that verifies
 * for the wrong room would let anyone with a ticket to their own room walk
 * into any other.
 */
export async function verifyTicket(
  token: string,
  room: string,
  secret: string,
  now = Date.now()
): Promise<TicketClaims | null> {
  const claims = await verify<TicketClaims>(token, secret, now);
  if (!claims) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  if (claims.room !== room) return null;
  return claims;
}

/** A fresh random id for a guest. 128 bits — collisions are not a concern. */
export function newPlayerId(prefix = "g"): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${prefix}_${base64urlEncode(bytes)}`;
}

/** A signing secret, for a deployment that has not been given one. */
export function newSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}
