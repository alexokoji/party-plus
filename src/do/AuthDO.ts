/// <reference types="@cloudflare/workers-types" />
import {
  checkCredentials,
  hashPassword,
  needsRehash,
  usernameKey,
  verifyPassword,
} from "../auth/passwords";
import { issueIdentity, newPlayerId, newSecret, verifyIdentity } from "../auth/tokens";
import {
  emailKey,
  hashOneTimeSecret,
  isValidEmail,
  maskEmail,
  newOneTimeSecret,
  passwordChangedEmail,
  RESET_TTL_MS,
  resetEmail,
  resetLink,
  sameHash,
  sendEmail,
  verificationEmail,
  verifyLink,
  VERIFY_TTL_MS,
  type EmailEnv,
  type OneTimePurpose,
} from "../auth/email";

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
  /** Lower-cased address, or null for accounts made before email existed. */
  email: string | null;
  /** As typed, for display and for addressing mail. */
  emailDisplay: string | null;
  emailVerified: boolean;
  /**
   * Bumped on every password change.
   *
   * Tokens carry the version they were issued under, so a reset invalidates
   * every session that existed before it — which is the point of resetting
   * when somebody else is in your account.
   */
  passwordVersion: number;
  createdAt: number;
  lastLoginAt: number | null;
}

/** A pending verification or reset link. Only the hash of the secret is kept. */
interface OneTimeToken {
  hash: string;
  userId: string;
  purpose: OneTimePurpose;
  expiresAt: number;
  /** The address being confirmed, for a verification that changes it. */
  email?: string;
}

/** Failed-login state, per account. */
interface Attempts {
  count: number;
  /** Locked until this time; 0 when not locked. */
  lockedUntil: number;
}

const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;

export interface AuthEnv extends EmailEnv {
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
      case "/forgot":
        return this.forgot(body as { email?: string });
      case "/reset":
        return this.reset(body as { token?: string; password?: string });
      case "/verify":
        return this.verify(body as { token?: string });
      case "/set-email":
        return this.setEmail(body as { token?: string; email?: string });
      case "/resend-verification":
        return this.resendVerification(body as { token?: string });
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
    const email = String(body.email ?? "").trim();

    const problem = checkCredentials(username, password);
    if (problem) return Response.json({ error: problem.message, field: problem.field }, { status: 400 });

    // Email is required for new accounts: without one there is no way back in
    // after a forgotten password, and "your account is gone" is a much worse
    // conversation than one extra field at sign-up.
    if (!isValidEmail(email)) {
      return Response.json({ error: "Enter a valid email address.", field: "email" }, { status: 400 });
    }

    const key = usernameKey(username);
    if (await this.storage.get<StoredUser>(`user:${key}`)) {
      // Deliberately explicit: username availability is public anyway (you
      // find out by trying), and pretending otherwise only confuses people.
      return Response.json({ error: "That username is taken.", field: "username" }, { status: 409 });
    }

    const mailKey = emailKey(email);
    if (await this.storage.get<string>(`email:${mailKey}`)) {
      return Response.json(
        { error: "That email already has an account. Try signing in.", field: "email" },
        { status: 409 }
      );
    }

    const secret = await this.secret();
    const existing = body.token ? await verifyIdentity(body.token, secret) : null;
    const id = existing?.kind === "guest" ? existing.sub : newPlayerId("u");

    const user: StoredUser = {
      id,
      username,
      displayName: cleanName(body.name) || username,
      passwordHash: await hashPassword(password),
      email: mailKey,
      emailDisplay: email,
      emailVerified: false,
      passwordVersion: 1,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
    await this.storage.put(`user:${key}`, user);
    await this.storage.put(`id:${id}`, key);
    await this.storage.put(`email:${mailKey}`, key);

    const delivery = await this.sendOneTime(user, "verify", mailKey);

    const token = await issueIdentity(
      { sub: id, name: user.displayName, kind: "user", pv: user.passwordVersion },
      secret
    );
    return Response.json({ token, user: publicUser(user), verification: delivery });
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
      { sub: user!.id, name: user!.displayName, kind: "user", pv: user!.passwordVersion },
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
    // Nor one issued before the password changed: that is how a reset evicts
    // whoever was already signed in.
    if ((claims.pv ?? 0) !== user.passwordVersion) {
      return Response.json({ error: "session expired" }, { status: 401 });
    }
    return Response.json({ user: publicUser(user) });
  }

  /**
   * Issues a one-time link and mails it.
   *
   * Only the hash of the secret is stored, so a dump of this object does not
   * hand over the ability to take over every account. Issuing a new link of a
   * given purpose drops the previous one, so a second "forgot password" does
   * not leave two live keys to the same door.
   */
  private async sendOneTime(
    user: StoredUser,
    purpose: OneTimePurpose,
    email: string
  ): Promise<{ sent: boolean; via: string; devLink?: string }> {
    const secret = newOneTimeSecret();
    const record: OneTimeToken = {
      hash: await hashOneTimeSecret(secret),
      userId: user.id,
      purpose,
      expiresAt: Date.now() + (purpose === "verify" ? VERIFY_TTL_MS : RESET_TTL_MS),
      email,
    };
    await this.storage.put(`otp:${purpose}:${user.id}`, record);

    const link = purpose === "verify" ? verifyLink(this.env, secret) : resetLink(this.env, secret);
    const message =
      purpose === "verify"
        ? verificationEmail(user.emailDisplay ?? email, user.displayName, link)
        : resetEmail(user.emailDisplay ?? email, user.displayName, link);
    const result = await sendEmail(this.env, message, link);
    return { sent: result.sent, via: result.via, devLink: result.devLink };
  }

  /**
   * Finds the account a link secret belongs to.
   *
   * The stored record is keyed by user, not by secret, so this walks the
   * pending tokens of one purpose. At party-game scale that is a handful of
   * rows; if it ever is not, key a second index by hash.
   */
  private async findOneTime(
    secret: string,
    purpose: OneTimePurpose
  ): Promise<{ user: StoredUser; key: string; record: OneTimeToken; storageKey: string } | null> {
    if (!secret) return null;
    const hash = await hashOneTimeSecret(secret);
    const pending = await this.storage.list<OneTimeToken>({ prefix: `otp:${purpose}:` });

    for (const [storageKey, record] of pending) {
      if (!sameHash(record.hash, hash)) continue;
      // Expired links are removed rather than merely refused, so a stale row
      // cannot sit there forever.
      if (record.expiresAt <= Date.now()) {
        await this.storage.delete(storageKey);
        return null;
      }
      const userKey = await this.storage.get<string>(`id:${record.userId}`);
      const user = userKey ? await this.storage.get<StoredUser>(`user:${userKey}`) : null;
      if (!user || !userKey) return null;
      return { user, key: userKey, record, storageKey };
    }
    return null;
  }

  /**
   * Spends a link.
   *
   * Separate from finding it on purpose: a reset has to validate the new
   * password *before* the link is gone, or a mistyped short password costs
   * somebody their only way back into the account and they have to go back to
   * their inbox for another mail.
   */
  private async consumeOneTime(
    secret: string,
    purpose: OneTimePurpose
  ): Promise<{ user: StoredUser; key: string; record: OneTimeToken } | null> {
    const found = await this.findOneTime(secret, purpose);
    if (!found) return null;
    await this.storage.delete(found.storageKey);
    return { user: found.user, key: found.key, record: found.record };
  }

  /**
   * Starts a password reset.
   *
   * Always answers the same way. Saying "no account with that email" turns
   * this endpoint into a way to test whether someone has an account here,
   * which is exactly the kind of thing people would rather not publish.
   */
  private async forgot(body: { email?: string }): Promise<Response> {
    const email = String(body.email ?? "").trim();
    const same = { ok: true, message: "If that address has an account, a reset link is on its way." };
    if (!isValidEmail(email)) return Response.json(same);

    const userKey = await this.storage.get<string>(`email:${emailKey(email)}`);
    const user = userKey ? await this.storage.get<StoredUser>(`user:${userKey}`) : null;
    if (!user) return Response.json(same);

    const delivery = await this.sendOneTime(user, "reset", emailKey(email));
    // devLink only appears when no mail provider is configured, which is
    // development — it is how the flow is testable without a mailbox.
    return Response.json({ ...same, devLink: delivery.devLink });
  }

  /** Finishes a reset: new password, every old session dead. */
  private async reset(body: { token?: string; password?: string }): Promise<Response> {
    const password = String(body.password ?? "");
    const secret = String(body.token ?? "");
    const found = await this.findOneTime(secret, "reset");
    if (!found) {
      return Response.json({ error: "That link has expired or has already been used." }, { status: 400 });
    }

    // Checked while the link is still live: a mistyped short password should
    // cost a retry, not a trip back to the inbox for a fresh mail.
    const problem = checkCredentials(found.user.username, password);
    if (problem) {
      return Response.json({ error: problem.message, field: problem.field }, { status: 400 });
    }

    const spent = await this.consumeOneTime(secret, "reset");
    if (!spent) {
      // Someone used the same link in the moment between the two steps.
      return Response.json({ error: "That link has expired or has already been used." }, { status: 400 });
    }

    const user = spent.user;
    user.passwordHash = await hashPassword(password);
    user.passwordVersion += 1;
    // Resetting through a link proves control of the mailbox, so the address
    // is verified by definition.
    user.emailVerified = true;
    await this.storage.put(`user:${spent.key}`, user);
    // Any other pending reset for this account is now void.
    await this.storage.delete(`otp:reset:${user.id}`);

    if (user.emailDisplay) {
      await sendEmail(this.env, passwordChangedEmail(user.emailDisplay, user.displayName));
    }

    const token = await issueIdentity(
      { sub: user.id, name: user.displayName, kind: "user", pv: user.passwordVersion },
      await this.secret()
    );
    return Response.json({ token, user: publicUser(user) });
  }

  /** Confirms an address from a verification link. */
  private async verify(body: { token?: string }): Promise<Response> {
    const found = await this.consumeOneTime(String(body.token ?? ""), "verify");
    if (!found) {
      return Response.json({ error: "That link has expired or has already been used." }, { status: 400 });
    }

    const user = found.user;
    // A verification issued for a pending address change is what commits it.
    if (found.record.email && found.record.email !== user.email) {
      if (user.email) await this.storage.delete(`email:${user.email}`);
      user.email = found.record.email;
      await this.storage.put(`email:${found.record.email}`, found.key);
    }
    user.emailVerified = true;
    await this.storage.put(`user:${found.key}`, user);
    return Response.json({ user: publicUser(user) });
  }

  /** Adds or changes an address. The new one is only live once confirmed. */
  private async setEmail(body: { token?: string; email?: string }): Promise<Response> {
    const claims = body.token ? await verifyIdentity(body.token, await this.secret()) : null;
    if (!claims || claims.kind !== "user") return Response.json({ error: "not signed in" }, { status: 401 });

    const email = String(body.email ?? "").trim();
    if (!isValidEmail(email)) {
      return Response.json({ error: "Enter a valid email address.", field: "email" }, { status: 400 });
    }

    const key = await this.storage.get<string>(`id:${claims.sub}`);
    const user = key ? await this.storage.get<StoredUser>(`user:${key}`) : null;
    if (!user || !key) return Response.json({ error: "not signed in" }, { status: 401 });

    const mailKey = emailKey(email);
    const owner = await this.storage.get<string>(`email:${mailKey}`);
    if (owner && owner !== key) {
      return Response.json({ error: "That email already has an account.", field: "email" }, { status: 409 });
    }

    // Held as pending until the link is clicked: claiming an address you do
    // not control must not take it away from anybody, nor redirect a future
    // reset to it.
    user.emailDisplay = email;
    if (!user.email) {
      user.email = mailKey;
      await this.storage.put(`email:${mailKey}`, key);
    }
    user.emailVerified = user.email === mailKey ? false : user.emailVerified;
    await this.storage.put(`user:${key}`, user);

    const delivery = await this.sendOneTime(user, "verify", mailKey);
    return Response.json({ user: publicUser(user), verification: delivery });
  }

  private async resendVerification(body: { token?: string }): Promise<Response> {
    const claims = body.token ? await verifyIdentity(body.token, await this.secret()) : null;
    if (!claims || claims.kind !== "user") return Response.json({ error: "not signed in" }, { status: 401 });

    const key = await this.storage.get<string>(`id:${claims.sub}`);
    const user = key ? await this.storage.get<StoredUser>(`user:${key}`) : null;
    if (!user?.email) return Response.json({ error: "No email on this account." }, { status: 400 });
    if (user.emailVerified) return Response.json({ user: publicUser(user), alreadyVerified: true });

    const delivery = await this.sendOneTime(user, "verify", user.email);
    return Response.json({ user: publicUser(user), verification: delivery });
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
      if ((claims.pv ?? 0) !== user.passwordVersion) {
        return Response.json({ error: "session expired" }, { status: 401 });
      }
      user.displayName = name;
      await this.storage.put(`user:${key}`, user);
      const reissued = await issueIdentity(
        { sub: claims.sub, name, kind: "user", pv: user.passwordVersion },
        await this.secret()
      );
      return Response.json({ token: reissued, user: publicUser(user) });
    }

    const token = await issueIdentity({ sub: claims.sub, name, kind: claims.kind }, await this.secret());
    return Response.json({ token, user: { id: claims.sub, name, kind: claims.kind } });
  }
}

interface RegisterBody {
  username?: string;
  password?: string;
  name?: string;
  email?: string;
  /** An existing guest token, so the player keeps their id. */
  token?: string;
}

interface LoginBody {
  username?: string;
  password?: string;
}

/** Never includes the password hash, and never the raw stored email key. */
function publicUser(user: StoredUser) {
  return {
    id: user.id,
    name: user.displayName,
    username: user.username,
    kind: "user" as const,
    email: user.emailDisplay,
    emailVerified: user.emailVerified,
  };
}

function cleanName(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
}
