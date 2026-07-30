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
  name?: string
): Promise<AuthResult> {
  // Passes the current guest token so the account inherits that player id and
  // the seat they may already be sitting in.
  const { token, user } = await post<{ token: string; user: Account }>("/auth/register", {
    username,
    password,
    name: name || getDisplayName(),
    token: readToken() || undefined,
  });
  writeToken(token);
  if (user.name) setDisplayName(user.name);
  return { account: user, token };
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
