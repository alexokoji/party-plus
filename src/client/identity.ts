"use client";

import { roomHttpBase } from "./roomUrl";

/**
 * Who the player is, as far as the client knows.
 *
 * The important part is what this file no longer does: it used to invent a
 * player id locally and send it to the server, which believed it. Identity is
 * now a token the SERVER issued and signed; the client only stores it. A
 * doctored client can change the name in localStorage all it likes and still
 * cannot become somebody else.
 */

const TOKEN_KEY = "party-plus.token";
const NAME_KEY = "party-plus.displayName";

export type AccountKind = "guest" | "user";

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Set only for real accounts. */
  username?: string;
  email?: string | null;
  emailVerified?: boolean;
}

/**
 * What happened to an email we asked the server to send.
 *
 * `devLink` only appears when no mail provider is configured — the server
 * hands back the link so the flow can be walked locally without a mailbox.
 */
export interface Delivery {
  sent: boolean;
  via: string;
  devLink?: string;
  /**
   * The provider accepted it but will not deliver it — a shared test sending
   * domain. Surfaced so nobody is told to check an inbox that will stay empty.
   */
  restricted?: boolean;
}

export interface AuthResult {
  account: Account;
  token: string;
}

function readToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private browsing with storage disabled: the session still works, it
    // just will not survive a reload.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function getDisplayName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setDisplayName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* not remembered, but applies this session */
  }
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`${roomHttpBase()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

/**
 * The current identity, minting a guest one if there is none.
 *
 * Everyone is authenticated, including people who never sign up — that is what
 * closes the impersonation hole without putting a signup wall in front of a
 * game people join from a shared link.
 */
export async function ensureIdentity(): Promise<AuthResult> {
  const existing = readToken();
  if (existing) {
    try {
      const { user } = await post<{ user: Account }>("/auth/me", {}, existing);
      return { account: user, token: existing };
    } catch {
      // Expired, or signed with a secret that has since changed. Fall through
      // and start again as a guest rather than stranding them.
      clearToken();
    }
  }
  const { token, user } = await post<{ token: string; user: Account }>("/auth/guest", {
    name: getDisplayName(),
  });
  writeToken(token);
  return { account: user, token };
}

export async function register(
  username: string,
  password: string,
  email: string,
  name?: string
): Promise<AuthResult & { verification?: Delivery }> {
  // Passes the current guest token so the account inherits that player id and
  // the seat they may already be sitting in.
  const { token, user, verification } = await post<{
    token: string;
    user: Account;
    verification?: Delivery;
  }>("/auth/register", {
    username,
    password,
    email,
    name: name || getDisplayName(),
    token: readToken() || undefined,
  });
  writeToken(token);
  if (user.name) setDisplayName(user.name);
  return { account: user, token, verification };
}

/**
 * Asks for a reset link.
 *
 * Always resolves, whatever the address — the server deliberately gives the
 * same answer for an unknown one, so this endpoint cannot be used to find out
 * who has an account.
 */
export async function forgotPassword(
  email: string
): Promise<{ message: string; devLink?: string; restricted?: boolean }> {
  return post<{ message: string; devLink?: string; restricted?: boolean }>("/auth/forgot", { email });
}

/** Finishes a reset. The returned token replaces every earlier session. */
export async function resetPassword(token: string, password: string): Promise<AuthResult> {
  const result = await post<{ token: string; user: Account }>("/auth/reset", { token, password });
  writeToken(result.token);
  if (result.user.name) setDisplayName(result.user.name);
  return { account: result.user, token: result.token };
}

/** Confirms an address from a link. Does not require being signed in. */
export async function verifyEmail(token: string): Promise<Account> {
  const { user } = await post<{ user: Account }>("/auth/verify", { token });
  return user;
}

/** Adds or changes the address on an account; the new one needs confirming. */
export async function setEmail(email: string, token: string): Promise<{ account: Account; verification?: Delivery }> {
  const result = await post<{ user: Account; verification?: Delivery }>("/auth/set-email", { email }, token);
  return { account: result.user, verification: result.verification };
}

export async function resendVerification(token: string): Promise<{ verification?: Delivery }> {
  return post<{ verification?: Delivery }>("/auth/resend-verification", {}, token);
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const { token, user } = await post<{ token: string; user: Account }>("/auth/login", {
    username,
    password,
  });
  writeToken(token);
  if (user.name) setDisplayName(user.name);
  return { account: user, token };
}

/** Signs out and immediately becomes a fresh guest. */
export async function signOut(): Promise<AuthResult> {
  clearToken();
  return ensureIdentity();
}

export async function rename(name: string, token: string): Promise<AuthResult> {
  const result = await post<{ token: string; user: Account }>("/auth/rename", { name }, token);
  writeToken(result.token);
  setDisplayName(name);
  return { account: result.user, token: result.token };
}

/** Creates a room server-side and returns its code. */
export async function createRoom(token: string): Promise<string> {
  const { code } = await post<{ code: string }>("/rooms", {}, token);
  return code;
}

/**
 * Trades the identity token for a short-lived ticket to one room.
 *
 * Two reasons this exists rather than putting the identity token in the socket
 * URL: URLs end up in logs, and a ticket is worthless for any other room and
 * expires in about a minute.
 */
export async function roomTicket(code: string, token: string, name?: string): Promise<string> {
  const { ticket } = await post<{ ticket: string }>(`/rooms/${encodeURIComponent(code)}/ticket`, {
    name,
  }, token);
  return ticket;
}
