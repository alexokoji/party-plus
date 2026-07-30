"use client";

import { useEffect, useState } from "react";
import {
  ensureIdentity,
  login as loginRequest,
  register as registerRequest,
  signOut as signOutRequest,
  type Account,
} from "../client/identity";

export interface AccountPanelProps {
  /** Lets the hub keep its name field in step with the signed-in account. */
  onName?: (name: string) => void;
}

/**
 * Sign in, sign up, or carry on as a guest.
 *
 * Guests are first-class here: everyone gets a server-issued signed identity
 * on arrival, so nobody can be impersonated whether or not they ever sign up.
 * An account only adds the ability to be the same player on another device.
 */
export function AccountPanel({ onName }: AccountPanelProps) {
  const [account, setAccount] = useState<Account | null>(null);
  const [mode, setMode] = useState<"closed" | "login" | "register">("closed");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ensureIdentity()
      .then(({ account }) => setAccount(account))
      .catch((err) => setError(err instanceof Error ? err.message : "could not sign in"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "register"
          ? await registerRequest(username, password)
          : await loginRequest(username, password);
      setAccount(result.account);
      onName?.(result.account.name);
      setMode("closed");
      setUsername("");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const { account } = await signOutRequest();
      setAccount(account);
      onName?.(account.name);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-panel account-panel">
      <div className="account-row">
        <span className="account-who">
          {account?.kind === "user" ? (
            <>
              Signed in as <strong>{account.username}</strong>
            </>
          ) : (
            <>Playing as a guest</>
          )}
        </span>

        {account?.kind === "user" ? (
          <button type="button" className="ghost" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        ) : (
          <span className="account-actions">
            <button type="button" className="ghost" onClick={() => setMode(mode === "login" ? "closed" : "login")}>
              Sign in
            </button>
            <button type="button" className="ghost" onClick={() => setMode(mode === "register" ? "closed" : "register")}>
              Create account
            </button>
          </span>
        )}
      </div>

      {account?.kind !== "user" && mode === "closed" && (
        <p className="hint">
          A guest identity is signed by the server, so nobody can play as you — it just
          cannot follow you to another device. An account can.
        </p>
      )}

      {mode !== "closed" && (
        <form className="account-form" onSubmit={submit}>
          <label>
            <span>Username</span>
            <input
              value={username}
              autoComplete="username"
              maxLength={20}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
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
          <button type="submit" disabled={busy || !username || !password}>
            {busy ? "…" : mode === "register" ? "Create account" : "Sign in"}
          </button>
          {mode === "register" && (
            <p className="hint">
              At least 8 characters. Your current guest identity comes with you, so you
              keep any seat you are already sitting in.
            </p>
          )}
        </form>
      )}

      {error && <p className="error-note">{error}</p>}
    </div>
  );
}
