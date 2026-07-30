"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPassword } from "../../src/client/identity";

/**
 * Choosing a new password from an emailed link.
 *
 * The link secret arrives in the query string and is spent here. Succeeding
 * signs this browser in and signs every other session out — including whoever
 * prompted the reset in the first place.
 */
function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push("/"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="card-panel">
        <h1>No reset link</h1>
        <p>This page needs the link from your email. Ask for a new one from the hub.</p>
        <Link href="/">← Hub</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card-panel">
        <h1>Password changed</h1>
        <p>You are signed in on this device, and signed out everywhere else. Taking you to the hub…</p>
        <Link href="/">← Hub</Link>
      </div>
    );
  }

  return (
    <div className="card-panel">
      <h1>Choose a new password</h1>
      <form className="account-form" onSubmit={submit}>
        <label>
          <span>New password</span>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            maxLength={200}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          <span>Again</span>
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            maxLength={200}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || !password || mismatch}>
          {busy ? "…" : "Set password"}
        </button>
        <p className="hint">
          At least 8 characters. Everywhere you are currently signed in will be signed out.
        </p>
      </form>
      {mismatch && <p className="error-note">Those do not match.</p>}
      {error && <p className="error-note">{error}</p>}
      <Link href="/">← Hub</Link>
    </div>
  );
}

export default function ResetPage() {
  return (
    <main>
      <Suspense fallback={<p>Loading…</p>}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
