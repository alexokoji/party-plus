/**
 * Password hashing.
 *
 * PBKDF2-HMAC-SHA256 via Web Crypto. Not the strongest choice available in
 * general — argon2id or scrypt resist GPU attack better — but it is what a
 * Worker can do without shipping a WASM build, and it is enormously better
 * than the alternatives that need no dependency at all.
 *
 * Stored form: `pbkdf2$<iterations>$<salt>$<hash>`, base64url. The iteration
 * count travels with the hash so it can be raised later without invalidating
 * everyone's password: verify with the stored count, re-hash on next login.
 */

const ITERATIONS = 150_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

const encoder = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = ITERATIONS): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(hash)}`;
}

/** Constant-time compare, so a near-miss cannot be found by timing. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5_000_000) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = unb64(parts[2]!);
    expected = unb64(parts[3]!);
  } catch {
    return false;
  }

  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

/** True when a hash should be replaced because the cost has since gone up. */
export function needsRehash(stored: string): boolean {
  const iterations = Number(stored.split("$")[1]);
  return !Number.isInteger(iterations) || iterations < ITERATIONS;
}

export interface CredentialProblem {
  field: "username" | "password";
  message: string;
}

/**
 * Username and password rules.
 *
 * Deliberately light on composition rules — length does more for real safety
 * than forcing a digit and a symbol, which mostly produces Password1! — and
 * paired with login rate limiting and per-account lockout.
 */
export function checkCredentials(username: string, password: string): CredentialProblem | null {
  const name = username.trim();
  if (name.length < 3) return { field: "username", message: "Username needs at least 3 characters." };
  if (name.length > 20) return { field: "username", message: "Username can be at most 20 characters." };
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return { field: "username", message: "Letters, numbers and underscores only." };
  }
  if (password.length < 8) return { field: "password", message: "Password needs at least 8 characters." };
  if (password.length > 200) return { field: "password", message: "Password is too long." };
  if (password.toLowerCase().includes(name.toLowerCase())) {
    return { field: "password", message: "Password must not contain your username." };
  }
  // The handful that show up in every breach list. Not a substitute for rate
  // limiting, just a cheap way to stop the very worst.
  const WORST = ["password", "12345678", "qwerty123", "letmein1", "iloveyou", "adminadmin"];
  if (WORST.includes(password.toLowerCase())) {
    return { field: "password", message: "That password is too common." };
  }
  return null;
}

/** Usernames are compared case-insensitively so nobody can register "Alex" twice. */
export const usernameKey = (username: string) => username.trim().toLowerCase();
