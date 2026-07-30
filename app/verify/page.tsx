"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { verifyEmail } from "../../src/client/identity";

/**
 * Confirming an address from an emailed link.
 *
 * Deliberately does not require being signed in: people open mail on a
 * different device from the one they signed up on, and making them sign in
 * first to prove they own an address they are in the middle of proving they
 * own is the kind of loop that gets accounts abandoned.
 */
function VerifyBody() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  // Effects run twice in development; without this the second run spends a
  // link that the first already consumed and reports a failure.
  const started = useRef(false);

  useEffect(() => {
    if (!token) {
      setState("failed");
      setMessage("This page needs the link from your email.");
      return;
    }
    if (started.current) return;
    started.current = true;

    verifyEmail(token)
      .then((user) => {
        setUsername(user.username ?? user.name);
        setState("done");
      })
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : "That link did not work.");
        setState("failed");
      });
  }, [token]);

  return (
    <div className="card-panel">
      {state === "working" && <h1>Confirming…</h1>}
      {state === "done" && (
        <>
          <h1>Email confirmed</h1>
          <p>
            {username ? `${username} is` : "You are"} all set. If you ever forget your password, you
            can get back in from the hub.
          </p>
        </>
      )}
      {state === "failed" && (
        <>
          <h1>That link didn&apos;t work</h1>
          <p>{message}</p>
          <p className="hint">
            Links last 24 hours and work once. Sign in and ask for a new one from the account panel.
          </p>
        </>
      )}
      <Link href="/">← Hub</Link>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <main>
      <Suspense fallback={<p>Loading…</p>}>
        <VerifyBody />
      </Suspense>
    </main>
  );
}
