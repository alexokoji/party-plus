import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  emailKey,
  hashOneTimeSecret,
  isTestSendingDomain,
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
} from "./email";

describe("addresses", () => {
  it("accepts ordinary and awkward-but-valid addresses", () => {
    for (const email of [
      "ada@example.com",
      "ada.lovelace+games@example.co.uk",
      "a@b.io",
      "TEST@EXAMPLE.COM",
      "first_last@sub.domain.example",
    ]) {
      expect(isValidEmail(email), email).toBe(true);
    }
  });

  it("rejects the ones that cannot possibly work", () => {
    for (const email of [
      "",
      "  ",
      "no-at-sign",
      "@example.com",
      "ada@",
      "ada@localhost",
      "ada@@example.com",
      "ada@.com",
      "ada@example.",
      "ada@exa..mple.com",
      "has space@example.com",
      `${"a".repeat(250)}@example.com`,
    ]) {
      expect(isValidEmail(email), email).toBe(false);
    }
  });

  it("compares case-insensitively so one mailbox is one account", () => {
    expect(emailKey("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("does not treat dots and +tags as the same mailbox", () => {
    // Those are provider conventions, not standards; collapsing them would
    // deny someone a signup on a host where they genuinely differ.
    expect(emailKey("a.b@example.com")).not.toBe(emailKey("ab@example.com"));
    expect(emailKey("ada+games@example.com")).not.toBe(emailKey("ada@example.com"));
  });

  it("masks an address for display without giving it away", () => {
    const masked = maskEmail("alexander@example.com");
    expect(masked.endsWith("@example.com")).toBe(true);
    expect(masked).not.toContain("alexander");
    expect(masked.startsWith("a")).toBe(true);
  });
});

describe("one-time link secrets", () => {
  it("mints unpredictable secrets", () => {
    const secrets = new Set(Array.from({ length: 200 }, () => newOneTimeSecret()));
    expect(secrets.size).toBe(200);
    expect(newOneTimeSecret().length).toBeGreaterThanOrEqual(40);
  });

  it("stores a hash, never the secret itself", async () => {
    const secret = newOneTimeSecret();
    const hash = await hashOneTimeSecret(secret);
    expect(hash).not.toBe(secret);
    expect(hash).not.toContain(secret.slice(0, 12));
    // A stolen database of hashes cannot be turned back into working links.
    expect(hash.length).toBeGreaterThan(20);
  });

  it("hashes deterministically, so a link can be recognised", async () => {
    const secret = newOneTimeSecret();
    expect(await hashOneTimeSecret(secret)).toBe(await hashOneTimeSecret(secret));
    expect(await hashOneTimeSecret(secret)).not.toBe(await hashOneTimeSecret(newOneTimeSecret()));
  });

  it("compares hashes without leaking position through timing", () => {
    expect(sameHash("abcdef", "abcdef")).toBe(true);
    expect(sameHash("abcdef", "abcdeg")).toBe(false);
    expect(sameHash("abc", "abcdef")).toBe(false);
  });

  it("gives a reset link a much shorter life than a verification", () => {
    expect(RESET_TTL_MS).toBeLessThan(VERIFY_TTL_MS);
    expect(RESET_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});

describe("links", () => {
  it("points at the configured app", () => {
    const env = { APP_URL: "https://party.example.com/" };
    expect(verifyLink(env, "abc")).toBe("https://party.example.com/verify?token=abc");
    expect(resetLink(env, "abc")).toBe("https://party.example.com/reset?token=abc");
  });

  it("escapes a secret so it survives the query string", () => {
    expect(resetLink({ APP_URL: "https://x.example" }, "a+b/c=")).toContain("a%2Bb%2Fc%3D");
  });

  it("falls back to localhost when unconfigured", () => {
    expect(verifyLink({}, "t")).toBe("http://localhost:3000/verify?token=t");
  });
});

describe("messages", () => {
  it("puts the link in both the text and the html part", () => {
    const link = "https://party.example.com/reset?token=secret123";
    const message = resetEmail("ada@example.com", "Ada", link);
    expect(message.text).toContain(link);
    expect(message.html).toContain(link);
    expect(message.subject.toLowerCase()).toContain("reset");
    expect(message.to).toBe("ada@example.com");
  });

  it("says a reset link works once and expires", () => {
    const message = resetEmail("ada@example.com", "Ada", "https://x");
    expect(message.text).toMatch(/once|hour/i);
  });

  it("tells someone who did not ask that they can ignore it", () => {
    // Otherwise an unexpected reset mail reads as "your account is broken".
    expect(resetEmail("a@b.co", "A", "https://x").text).toMatch(/ignore/i);
    expect(verificationEmail("a@b.co", "A", "https://x").text).toMatch(/ignore/i);
  });

  it("puts no link in the password-changed notice", () => {
    // A "your password changed" mail with a button in it is precisely what a
    // phishing attempt looks like.
    const message = passwordChangedEmail("ada@example.com", "Ada");
    expect(message.html).not.toContain("<a href");
    expect(message.text).not.toContain("http");
    expect(message.text).toMatch(/signed out/i);
  });
});

describe("sending", () => {
  const original = globalThis.fetch;
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });

  const message = { to: "ada@example.com", subject: "s", text: "t", html: "<p>h</p>" };

  it("logs the link instead of sending when nothing is configured", async () => {
    const result = await sendEmail({}, message, "https://link");
    expect(result).toMatchObject({ sent: false, via: "log", devLink: "https://link" });
  });

  it("does not hand back a dev link once a provider is configured", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const result = await sendEmail(
      { RESEND_API_KEY: "key", EMAIL_FROM: "Party <a@b.co>" },
      message,
      "https://link"
    );
    expect(result).toMatchObject({ sent: true, via: "resend" });
    expect(result.devLink).toBeUndefined();
  });

  it("sends what the provider expects, with the key in a header", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await sendEmail({ RESEND_API_KEY: "secret-key", EMAIL_FROM: "Party <a@b.co>" }, message);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ authorization: "Bearer secret-key" });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: "Party <a@b.co>", to: ["ada@example.com"], subject: "s" });
  });

  it("flags a shared test sending domain, which accepts mail and drops it", async () => {
    // The failure this exists to stop being silent: Resend answers 200 for
    // any recipient on resend.dev but only delivers to the account owner, so
    // the server sees success while real users get nothing at all.
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 })
    ) as unknown as typeof fetch;

    const restricted = await sendEmail(
      { RESEND_API_KEY: "k", EMAIL_FROM: "Party Plus <noreply@resend.dev>" },
      message
    );
    expect(restricted).toMatchObject({ sent: true, restricted: true, id: "abc" });

    const real = await sendEmail(
      { RESEND_API_KEY: "k", EMAIL_FROM: "Party Plus <no-reply@partyplus.example>" },
      message
    );
    expect(real.restricted).toBeFalsy();
  });

  it("recognises the test domain however the from address is written", () => {
    expect(isTestSendingDomain("Party Plus <noreply@resend.dev>")).toBe(true);
    expect(isTestSendingDomain("onboarding@RESEND.DEV")).toBe(true);
    expect(isTestSendingDomain("no-reply@partyplus.example")).toBe(false);
    // A lookalike domain is somebody else's, not the shared one.
    expect(isTestSendingDomain("hi@resend.dev.evil.example")).toBe(false);
    expect(isTestSendingDomain(undefined)).toBe(false);
  });

  it("reports a provider error without throwing", async () => {
    // A mail provider having a bad day must not turn a password reset into a
    // 500 — the caller answers the same way regardless.
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 422 })) as unknown as typeof fetch;
    const result = await sendEmail({ RESEND_API_KEY: "k", EMAIL_FROM: "f" }, message);
    expect(result.sent).toBe(false);
    expect(result.error).toContain("422");
  });

  it("survives the provider being unreachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await sendEmail({ RESEND_API_KEY: "k", EMAIL_FROM: "f" }, message);
    expect(result.sent).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
