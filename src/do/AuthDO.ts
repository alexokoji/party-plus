/// <reference types="@cloudflare/workers-types" />
import {
  checkCredentials,
  hashPassword,
  needsRehash,
  usernameKey,
  verifyPassword,
} from "../auth/passwords";
import { issueIdentity, newPlayerId, newSecret, verifyIdentity } from "../auth/tokens";

/**
 * The user directory.
 *
 * A single Durable Object instance holds every account, which means account
 * writes are serialised and username uniqueness needs no transaction — the
 * check and the write happen in the same single-threaded place. At party-game
 * scale that is the right trade; if it ever stops being, shard by the first
 * character of the username key.
 *
 * The signing secret lives here too. A deployment that sets AUTH_SECRET uses
 * that; one that does not gets a random secret generated on first use and kept
 * in storage, so the whole thing works on a fresh deploy with no setup. The
 * cost of the generated one is that wiping this DO signs everybody out.
 */

export interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  createdAt: number;
  lastLoginAt: number | null;
}

/** Failed-login state, per account. */
interface Attempts {
  count: number;
  /** Locked until this time; 0 when not locked. */
  lockedUntil: number;
}

const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;

export interface AuthEnv {
  AUTH_SECRET?: string;
}

export class AuthDO {
  private storage: DurableObjectStorage;
  private env: AuthEnv;
  private cachedSecret: string | null = null;

  constructor(ctx: DurableObjectState, env: AuthEnv) {
    this.storage = ctx.storage;
    this.env = env;
  }

  /** The HMAC secret: configured, or generated once and remembered. */
  private async secret(): Promise<string> {
    if (this.env.AUTH_SECRET) return this.env.AUTH_SECRET;
    if (this.cachedSecret) return this.cachedSecret;
    const stored = await this.storage.get<string>("secret");
    if (stored) return (this.cachedSecret = stored);
    const fresh = newSecret();
    await this.storage.put("secret", fresh);
    return (this.cachedSecret = fresh);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));

    switch (url.pathname) {
      case "/guest":
        return this.guest(body as { name?: string });
      case "/register":
        return this.register(body as RegisterBody);
      case "/login":
        return this.login(body as LoginBody);
      case "/me":
        return this.me(body as { token?: string });
      case "/rename":
        return this.rename(body as { token?: string; name?: string });
      case "/secret":
        // Only ever called by the Worker in the same isolate, to verify
        // tokens and tickets without a round trip per socket message.
        return Response.json({ secret: await this.secret() });
      default:
        return new Response("not found", { status: 404 });
    }
  }

  /** A throwaway identity. No password, not recoverable, still authenticated. */
  private async guest(body: { name?: string }): Promise<Response> {
    const name = cleanName(body.name) || "Guest";
    const sub = newPlayerId("g");
    const token = await issueIdentity({ sub, name, kind: "guest" }, await this.secret());
    return Response.json({ token, user: { id: sub, name, kind: "guest" } });
  }

  /**
   * Claims a username.
   *
   * A guest who registers keeps their existing player id, so an account can be
   * claimed mid-session without losing the seat they are sitting in.
   */
  private async register(body: RegisterBody): Promise<Response> {
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");

    const problem = checkCredentials(username, password);
    if (problem) return Response.json({ error: problem.message, field: problem.field }, { status: 400 });

    const key = usernameKey(username);
    if (await this.storage.get<StoredUser>(`user:${key}`)) {
      // Deliberately explicit: username availability is public anyway (you
      // find out by trying), and pretending otherwise only confuses people.
      return Response.json({ error: "That username is taken.", field: "username" }, { status: 409 });
    }

    const secret = await this.secret();
    const existing = body.token ? await verifyIdentity(body.token, secret) : null;
    const id = existing?.kind === "guest" ? existing.sub : newPlayerId("u");

    const user: StoredUser = {
      id,
      username,
      displayName: cleanName(body.name) || username,
      passwordHash: await hashPassword(password),
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
    await this.storage.put(`user:${key}`, user);
    await this.storage.put(`id:${id}`, key);

    const token = await issueIdentity({ sub: id, name: user.displayName, kind: "user" }, secret);
    return Response.json({ token, user: publicUser(user) });
  }

  private async login(body: LoginBody): Promise<Response> {
    const key = usernameKey(String(body.username ?? ""));
    const password = String(body.password ?? "");
    const now = Date.now();

    const attemptsKey = `attempts:${key}`;
    const attempts = (await this.storage.get<Attempts>(attemptsKey)) ?? { count: 0, lockedUntil: 0 };
    if (attempts.lockedUntil > now) {
      const minutes = Math.ceil((attempts.lockedUntil - now) / 60_000);
      return Response.json(
        { error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
        { status: 429 }
      );
    }

    const user = await this.storage.get<StoredUser>(`user:${key}`);
    // Same message whether the account is missing or the password is wrong:
    // the pair is what is secret, and saying which half failed hands an
    // attacker a list of real usernames.
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;

    if (!ok) {
      const count = attempts.count + 1;
      await this.storage.put(attemptsKey, {
        count,
        lockedUntil: count >= LOCK_AFTER ? now + LOCK_MS : 0,
      } satisfies Attempts);
      return Response.json({ error: "Wrong username or password." }, { status: 401 });
    }

    await this.storage.delete(attemptsKey);

    // Raising the iteration count later only helps if hashes actually move up,
    // and a login is the one moment the plaintext is available to re-hash.
    if (needsRehash(user!.passwordHash)) {
      user!.passwordHash = await hashPassword(password);
    }
    user!.lastLoginAt = now;
    await this.storage.put(`user:${key}`, user!);

    const token = await issueIdentity(
      { sub: user!.id, name: user!.displayName, kind: "user" },
      await this.secret()
    );
    return Response.json({ token, user: publicUser(user!) });
  }

  /** Who is this token, if anyone. */
  private async me(body: { token?: string }): Promise<Response> {
    const claims = body.token ? await verifyIdentity(body.token, await this.secret()) : null;
    if (!claims) return Response.json({ error: "not signed in" }, { status: 401 });

    if (claims.kind === "guest") {
      return Response.json({ user: { id: claims.sub, name: claims.name, kind: "guest" } });
    }
    const key = await this.storage.get<string>(`id:${claims.sub}`);
    const user = key ? await this.storage.get<StoredUser>(`user:${key}`) : null;
    // A token for an account that no longer exists must not keep working.
    if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
    return Response.json({ user: publicUser(user) });
  }

  /** Changes the display name — not the username, which is the identity. */
  private async rename(body: { token?: string; name?: string }): Promise<Response> {
    const claims = body.token ? await verifyIdentity(body.token, await this.secret()) : null;
    if (!claims) return Response.json({ error: "not signed in" }, { status: 401 });

    const name = cleanName(body.name);
    if (!name) return Response.json({ error: "Name cannot be empty." }, { status: 400 });

    if (claims.kind === "user") {
      const key = await this.storage.get<string>(`id:${claims.sub}`);
      const user = key ? await this.storage.get<StoredUser>(`user:${key}`) : null;
      if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
      user.displayName = name;
      await this.storage.put(`user:${key}`, user);
    }

    const token = await issueIdentity({ sub: claims.sub, name, kind: claims.kind }, await this.secret());
    return Response.json({ token, user: { id: claims.sub, name, kind: claims.kind } });
  }
}

interface RegisterBody {
  username?: string;
  password?: string;
  name?: string;
  /** An existing guest token, so the player keeps their id. */
  token?: string;
}

interface LoginBody {
  username?: string;
  password?: string;
}

/** Never includes the password hash. */
function publicUser(user: StoredUser) {
  return { id: user.id, name: user.displayName, username: user.username, kind: "user" as const };
}

function cleanName(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
}
