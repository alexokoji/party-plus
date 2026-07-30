/**
 * Email: addresses, one-time links, and getting a message out of a Worker.
 *
 * Workers cannot open an SMTP connection, so sending is an HTTP call to a
 * provider. That is wrapped behind a small interface for two reasons: the
 * provider is a deployment choice rather than a code one, and local
 * development has to work with nothing configured at all — otherwise nobody
 * can test a reset without signing up for something first.
 */

export type OneTimePurpose = "verify" | "reset";

/** How long a link in an email stays good. */
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Address validation.
 *
 * Deliberately permissive: the only real proof an address works is that
 * somebody clicked a link in it, which is what verification is for. A strict
 * pattern here mostly rejects valid, unusual addresses.
 */
export function isValidEmail(value: string): boolean {
  const email = value.trim();
  if (email.length < 3 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const domain = email.slice(at + 1);
  if (domain.length < 3 || !domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  return true;
}

/**
 * The form used for lookups and uniqueness.
 *
 * Case only: no stripping of dots or +tags. Those are Gmail conventions, not
 * standards, and treating `a.b@` and `ab@` as one address would deny somebody
 * a sign-up on a provider where they are genuinely different mailboxes.
 */
export const emailKey = (email: string) => email.trim().toLowerCase();

/** Masked form, for telling someone where a mail went without publishing it. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : "";
  return `${head}${"•".repeat(Math.max(1, local.length - 2))}${tail}@${domain}`;
}

const b64url = (bytes: Uint8Array) => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A link secret: 256 bits, from the platform CSPRNG. */
export function newOneTimeSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

/**
 * What gets STORED for a one-time link.
 *
 * The secret itself is never persisted — only this hash — so a dump of the
 * auth object does not hand over the ability to reset everybody's password.
 * Same reasoning as a password hash, minus the need to be slow: the secret has
 * full entropy, so there is nothing to brute-force.
 */
export async function hashOneTimeSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return b64url(new Uint8Array(digest));
}

/** Length-independent compare of two stored hashes. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailEnv {
  /** Resend API key. Without it, mail is logged rather than sent. */
  RESEND_API_KEY?: string;
  /** From address, e.g. "Party Plus <no-reply@yourdomain.com>". */
  EMAIL_FROM?: string;
  /** Public URL of the web app, for building links. */
  APP_URL?: string;
}

export interface SendResult {
  sent: boolean;
  /** "resend" when really sent, "log" in development. */
  via: "resend" | "log";
  error?: string;
  /** Development only: the link, so it can be followed without a mailbox. */
  devLink?: string;
}

/**
 * Sends, or logs when unconfigured.
 *
 * The log fallback is what makes a fresh checkout usable: the reset link is
 * printed to the Worker output, so the flow can be walked end to end before
 * anyone signs up for an email provider. It is obvious in the logs that this
 * is happening, and production sets the key.
 */
export async function sendEmail(
  env: EmailEnv,
  message: EmailMessage,
  devLink?: string
): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.log(
      `[email:log] no RESEND_API_KEY/EMAIL_FROM configured — not sending.\n` +
        `  to: ${message.to}\n  subject: ${message.subject}\n` +
        (devLink ? `  link: ${devLink}\n` : "")
    );
    return { sent: false, via: "log", devLink };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // Logged, not thrown: a mail provider having a bad day must not turn a
      // password reset into a 500. The caller reports the same thing either
      // way, so this never becomes an account-enumeration signal.
      console.log(`[email:error] resend returned ${response.status}: ${detail.slice(0, 200)}`);
      return { sent: false, via: "resend", error: `provider returned ${response.status}` };
    }
    return { sent: true, via: "resend" };
  } catch (e) {
    console.log(`[email:error] ${e instanceof Error ? e.message : String(e)}`);
    return { sent: false, via: "resend", error: "could not reach the mail provider" };
  }
}

const appUrl = (env: EmailEnv) => (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function verifyLink(env: EmailEnv, secret: string): string {
  return `${appUrl(env)}/verify?token=${encodeURIComponent(secret)}`;
}

export function resetLink(env: EmailEnv, secret: string): string {
  return `${appUrl(env)}/reset?token=${encodeURIComponent(secret)}`;
}

/** Minimal HTML: plain, unstyled, and identical in substance to the text part. */
const wrap = (heading: string, body: string, action?: { url: string; label: string }) => `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c1917">
  <h1 style="font-size:20px;margin:0 0 16px">${heading}</h1>
  ${body}
  ${
    action
      ? `<p style="margin:24px 0">
    <a href="${action.url}" style="display:inline-block;padding:10px 18px;background:#1f7ae0;color:#fff;border-radius:6px;text-decoration:none">${action.label}</a>
  </p>
  <p style="font-size:13px;color:#57534e">Or paste this into your browser:<br><span style="word-break:break-all">${action.url}</span></p>`
      : ""
  }
</div>`;

export function verificationEmail(to: string, name: string, link: string): EmailMessage {
  return {
    to,
    subject: "Confirm your Party Plus email",
    text:
      `Hi ${name},\n\n` +
      `Confirm this address so you can reset your password if you ever lose it:\n${link}\n\n` +
      `The link works for 24 hours. If you did not create a Party Plus account, ignore this — nothing will happen.\n`,
    html: wrap(
      "Confirm your email",
      `<p>Hi ${name}, confirm this address so you can reset your password if you ever lose it.</p>
       <p style="font-size:13px;color:#57534e">The link works for 24 hours. If you did not create a Party Plus account, ignore this — nothing will happen.</p>`,
      { url: link, label: "Confirm email" }
    ),
  };
}

export function resetEmail(to: string, name: string, link: string): EmailMessage {
  return {
    to,
    subject: "Reset your Party Plus password",
    text:
      `Hi ${name},\n\n` +
      `Someone asked to reset your password. Use this link within the hour:\n${link}\n\n` +
      `If it was not you, you can ignore this — your password has not changed, and the link only works once.\n`,
    html: wrap(
      "Reset your password",
      `<p>Hi ${name}, someone asked to reset your password. The link below works once, within the hour.</p>
       <p style="font-size:13px;color:#57534e">If it was not you, ignore this — your password has not changed.</p>`,
      { url: link, label: "Choose a new password" }
    ),
  };
}

/** Sent to the old address after a change, so a hijack is not silent. */
export function passwordChangedEmail(to: string, name: string): EmailMessage {
  return {
    to,
    subject: "Your Party Plus password was changed",
    text:
      `Hi ${name},\n\n` +
      `Your password was just changed, and everywhere you were signed in has been signed out.\n\n` +
      `If this was not you, reset your password immediately — whoever did it has been signed out too.\n`,
    // No action button: this one is a notification, not a call to click
    // something — a "your password changed" mail with a link in it is exactly
    // what a phishing attempt looks like.
    html: wrap(
      "Your password was changed",
      `<p>Hi ${name}, your password was just changed and everywhere you were signed in has been signed out.</p>
       <p>If this was not you, reset it immediately — whoever did this has been signed out too.</p>`
    ),
  };
}
