"use client";

import { useEffect, useState } from "react";
import {
  ensureIdentity,
  forgotPassword,
  login as loginRequest,
  register as registerRequest,
  resendVerification,
  setEmail as setEmailRequest,
  signOut as signOutRequest,
  type Account,
  type Delivery,
} from "../client/identity";

export interface AccountPanelProps {
  /** Lets the hub keep its name field in step with the signed-in account. */
  onName?: (name: string) => void;
}

type Mode = "closed" | "login" | "register" | "forgot" | "addEmail";

/**
 * Sign in, sign up, recover, or carry on as a guest.
 *
 * Guests are first-class here: everyone gets a server-issued signed identity
 * on arrival, so nobody can be impersonated whether or not they ever sign up.
 * An account adds being the same player on another device — and an email adds
 * a way back in when the password is forgotten.
 */
export function AccountPanel({ onName }: AccountPanelProps) {
  const [account, setAccount] = useState<Account | null>(null);
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<Mode>("closed");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmailValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ensureIdentity()
      .then(({ account, token }) => {
        setAccount(account);
        setToken(token);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "could not sign in"));
  }, []);

  function reset(next: Mode = "closed") {
    setMode(next);
    setUsername("");
    setPassword("");
    setEmailValue("");
    setError(null);
  }

  /**
   * Surfaces the dev link when no mail provider is configured.
   *
   * Without this the local flow is a dead end: the server logs the link and
   * the person testing has no way to reach it.
   */
  function reportDelivery(delivery: Delivery | undefined, sentMessage: string) {
    setDevLink(delivery?.devLink ?? null);
    setNotice(delivery?.devLink ? "No mail provider configured — use the link below." : sentMessage);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setDevLink(null);
    try {
      if (mode === "register") {
        const result = await registerRequest(username, password, email);
        setAccount(result.account);
        setToken(result.token);
        onName?.(result.account.name);
        reportDelivery(result.verification, `Check ${email} to confirm your address.`);
        reset();
      } else if (mode === "login") {
        const result = await loginRequest(username, password);
        setAccount(result.account);
        setToken(result.token);
        onName?.(result.account.name);
        reset();
      } else if (mode === "forgot") {
        const result = await forgotPassword(email);
        setDevLink(result.devLink ?? null);
        setNotice(result.devLink ? "No mail provider configured — use the link below." : result.message);
        reset();
      } else if (mode === "addEmail") {
        const result = await setEmailRequest(email, token);
        setAccount(result.account);
        reportDelivery(result.verification, `Check ${email} to confirm your address.`);
        reset();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const result = await resendVerification(token);
      reportDelivery(result.verification, "Sent — check your inbox.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const { account, token } = await signOutRequest();
      setAccount(account);
      setToken(token);
      onName?.(account.name);
      setNotice(null);
      setDevLink(null);
    } finally {
      setBusy(false);
    }
  }

  const signedIn = account?.kind === "user";

  return (
    <div className="card-panel account-panel">
      <div className="account-row">
        <span className="account-who">
          {signedIn ? (
            <>
              Signed in as <strong>{account.username}</strong>
              {account.email && !account.emailVerified && (
                <span className="email-unverified"> · email not confirmed</span>
              )}
            </>
          ) : (
            <>Playing as a guest</>
          )}
        </span>

        {signedIn ? (
          <span className="account-actions">
            {!account.email && (
              <button type="button" className="ghost" onClick={() => reset(mode === "addEmail" ? "closed" : "addEmail")}>
                Add email
              </button>
            )}
            {account.email && !account.emailVerified && (
              <button type="button" className="ghost" disabled={busy} onClick={() => void resend()}>
                Resend confirmation
              </button>
            )}
            <button type="button" className="ghost" disabled={busy} onClick={() => void signOut()}>
              Sign out
            </button>
          </span>
        ) : (
          <span className="account-actions">
            <button type="button" className="ghost" onClick={() => reset(mode === "login" ? "closed" : "login")}>
              Sign in
            </button>
            <button type="button" className="ghost" onClick={() => reset(mode === "register" ? "closed" : "register")}>
              Create account
            </button>
          </span>
        )}
      </div>

      {!signedIn && mode === "closed" && (
        <p className="hint">
          A guest identity is signed by the server, so nobody can play as you — it just
          cannot follow you to another device. An account can.
        </p>
      )}

      {mode !== "closed" && (
        <form className="account-form" onSubmit={submit}>
          {(mode === "login" || mode === "register") && (
            <label>
              <span>Username</span>
              <input
                value={username}
                autoComplete="username"
                maxLength={20}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
          )}

          {(mode === "register" || mode === "forgot" || mode === "addEmail") && (
            <label>
              <span>Email</span>
              <input
                type="email"
                value={email}
                autoComplete="email"
                maxLength={254}
                onChange={(e) => setEmailValue(e.target.value)}
              />
            </label>
          )}

          {(mode === "login" || mode === "register") && (
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                maxLength={200}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          <button
            type="submit"
            disabled={
              busy ||
              (mode === "forgot" || mode === "addEmail" ? !email : !username || !password) ||
              (mode === "register" && !email)
            }
          >
            {busy
              ? "…"
              : mode === "register"
                ? "Create account"
                : mode === "login"
                  ? "Sign in"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Save email"}
          </button>

          {mode === "register" && (
            <p className="hint">
              At least 8 characters. Your email is only used to confirm the account and reset
              the password. Your current guest identity comes with you, so you keep any seat
              you are already sitting in.
            </p>
          )}
          {mode === "login" && (
            <button type="button" className="link-button" onClick={() => reset("forgot")}>
              Forgot your password?
            </button>
          )}
          {mode === "forgot" && (
            <p className="hint">
              We will send a link if that address has an account. It works once, within the hour.
            </p>
          )}
        </form>
      )}

      {notice && <p className="hint notice">{notice}</p>}
      {devLink && (
        <p className="hint dev-link">
          <a href={devLink}>{devLink}</a>
        </p>
      )}
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}
