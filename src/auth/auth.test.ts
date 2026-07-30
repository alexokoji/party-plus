import { describe, it, expect, vi } from "vitest";
import {
  IDENTITY_TTL_MS,
  issueIdentity,
  issueTicket,
  newPlayerId,
  newSecret,
  TICKET_TTL_MS,
  verifyIdentity,
  verifyTicket,
} from "./tokens";
import {
  checkCredentials,
  hashPassword,
  MAX_WORKERS_ITERATIONS,
  needsRehash,
  usernameKey,
  verifyPassword,
} from "./passwords";

const SECRET = "test-secret-not-used-anywhere-real";
const NOW = 1_700_000_000_000;

describe("identity tokens", () => {
  it("round-trips the claims it was given", async () => {
    const token = await issueIdentity({ sub: "u_1", name: "Ada", kind: "user" }, SECRET, NOW);
    const claims = await verifyIdentity(token, SECRET, NOW + 1000);
    expect(claims).toMatchObject({ sub: "u_1", name: "Ada", kind: "user" });
    expect(claims!.exp).toBe(NOW + IDENTITY_TTL_MS);
  });

  it("refuses a token signed with a different secret", async () => {
    const token = await issueIdentity({ sub: "u_1", name: "Ada", kind: "user" }, SECRET, NOW);
    expect(await verifyIdentity(token, "some-other-secret", NOW)).toBeNull();
  });

  it("refuses a token whose payload has been edited", async () => {
    // The attack this exists to stop: claim to be someone else.
    const token = await issueIdentity({ sub: "u_victim", name: "Ada", kind: "user" }, SECRET, NOW);
    const [body, sig] = token.split(".");
    const forgedBody = btoa(JSON.stringify({ sub: "u_attacker", name: "Ada", kind: "user", iat: NOW, exp: NOW + 1e9 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifyIdentity(`${forgedBody}.${sig}`, SECRET, NOW)).toBeNull();
    expect(await verifyIdentity(`${body}.${sig}`, SECRET, NOW)).not.toBeNull();
  });

  it("refuses an unsigned or malformed token", async () => {
    for (const bad of ["", ".", "nodot", "a.b.c", "....", "eyJzdWIiOiJ4In0."]) {
      expect(await verifyIdentity(bad, SECRET, NOW), bad).toBeNull();
    }
  });

  it("refuses an expired token", async () => {
    const token = await issueIdentity({ sub: "u_1", name: "Ada", kind: "user" }, SECRET, NOW, 1000);
    expect(await verifyIdentity(token, SECRET, NOW + 500)).not.toBeNull();
    expect(await verifyIdentity(token, SECRET, NOW + 1001)).toBeNull();
  });

  it("refuses a token with no subject", async () => {
    const token = await issueIdentity({ sub: "", name: "Ada", kind: "user" }, SECRET, NOW);
    expect(await verifyIdentity(token, SECRET, NOW)).toBeNull();
  });

  it("refuses an unknown kind", async () => {
    const token = await issueIdentity(
      { sub: "u_1", name: "Ada", kind: "admin" as "user" },
      SECRET,
      NOW
    );
    expect(await verifyIdentity(token, SECRET, NOW)).toBeNull();
  });
});

describe("room tickets", () => {
  it("admits the holder to the room it names", async () => {
    const ticket = await issueTicket({ sub: "u_1", name: "Ada", kind: "user", room: "ROOMONE1" }, SECRET, NOW);
    expect(await verifyTicket(ticket, "ROOMONE1", SECRET, NOW)).toMatchObject({ sub: "u_1" });
  });

  it("does NOT admit the holder to any other room", async () => {
    const ticket = await issueTicket({ sub: "u_1", name: "Ada", kind: "user", room: "ROOMONE1" }, SECRET, NOW);
    expect(await verifyTicket(ticket, "ROOMTWO2", SECRET, NOW)).toBeNull();
  });

  it("expires quickly, so a ticket in a log is worthless later", async () => {
    const ticket = await issueTicket({ sub: "u_1", name: "Ada", kind: "user", room: "R" }, SECRET, NOW);
    expect(TICKET_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(await verifyTicket(ticket, "R", SECRET, NOW + TICKET_TTL_MS + 1)).toBeNull();
  });

  it("cannot be forged from an identity token", async () => {
    // An identity token has no `room`, so it must not pass as a ticket.
    const identity = await issueIdentity({ sub: "u_1", name: "Ada", kind: "user" }, SECRET, NOW);
    expect(await verifyTicket(identity, "ROOMONE1", SECRET, NOW)).toBeNull();
  });

  it("is not accepted as an identity token either", async () => {
    // A ticket verifies structurally as an identity; that is fine and
    // deliberate — it carries the same subject — but it dies in 90 seconds.
    const ticket = await issueTicket({ sub: "u_1", name: "Ada", kind: "user", room: "R" }, SECRET, NOW);
    expect(await verifyIdentity(ticket, SECRET, NOW + TICKET_TTL_MS + 1)).toBeNull();
  });
});

describe("ids and secrets", () => {
  it("mints ids that do not collide", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newPlayerId()));
    expect(ids.size).toBe(500);
  });

  it("mints secrets with real entropy", () => {
    const a = newSecret();
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(newSecret()).not.toBe(a);
  });
});

describe("passwords", () => {
  it("accepts the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("correct horse battery", 1000);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterz", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("never stores the password itself", async () => {
    const stored = await hashPassword("hunter2-and-then-some", 1000);
    expect(stored).not.toContain("hunter2");
    expect(stored.startsWith("pbkdf2$1000$")).toBe(true);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same password here", 1000);
    const b = await hashPassword("same password here", 1000);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password here", b)).toBe(true);
  });

  it("refuses a malformed or truncated stored hash rather than throwing", async () => {
    for (const bad of ["", "nonsense", "pbkdf2$$$", "pbkdf2$1000$!!!$!!!", "md5$1$a$b", "pbkdf2$10$a$b"]) {
      expect(await verifyPassword("anything", bad), bad).toBe(false);
    }
  });

  it("knows when a stored hash is below the current cost", async () => {
    expect(needsRehash(await hashPassword("a-long-enough-password", 1000))).toBe(true);
    expect(needsRehash(await hashPassword("a-long-enough-password"))).toBe(false);
  });

  it("uses a real iteration count by default", async () => {
    const stored = await hashPassword("a-long-enough-password");
    expect(Number(stored.split("$")[1])).toBeGreaterThanOrEqual(100_000);
  });

  it("stays within the ceiling the Workers runtime enforces", async () => {
    // The runtime refuses PBKDF2 above 100,000 iterations, and local
    // `wrangler dev` does NOT enforce it — so a higher number passes every
    // test here and then throws on the first real registration in production.
    // It did. This is the guard.
    const stored = await hashPassword("a-long-enough-password");
    expect(Number(stored.split("$")[1])).toBeLessThanOrEqual(MAX_WORKERS_ITERATIONS);
  });

  it("refuses a hash this runtime cannot reproduce, rather than throwing", async () => {
    // Exactly what production did: the runtime rejects the stored parameters.
    // A hash written before the cap was known must not turn a login into a
    // 500 for everybody who has one.
    const stored = await hashPassword("a-long-enough-password", 1000);
    const deriveBits = vi
      .spyOn(crypto.subtle, "deriveBits")
      .mockRejectedValue(new Error("Pbkdf2 failed: iteration counts above 100000 are not supported"));

    await expect(verifyPassword("a-long-enough-password", stored)).resolves.toBe(false);
    deriveBits.mockRestore();
  });
});

describe("credential rules", () => {
  it("accepts a reasonable pair", () => {
    expect(checkCredentials("ada_lovelace", "analytical engine")).toBeNull();
  });

  it("rejects short or oddly-charactered usernames", () => {
    expect(checkCredentials("ab", "a-good-long-password")?.field).toBe("username");
    expect(checkCredentials("a".repeat(21), "a-good-long-password")?.field).toBe("username");
    expect(checkCredentials("has space", "a-good-long-password")?.field).toBe("username");
    expect(checkCredentials("emoji🎲", "a-good-long-password")?.field).toBe("username");
  });

  it("rejects short passwords, and passwords containing the username", () => {
    expect(checkCredentials("adalovelace", "short1")?.field).toBe("password");
    expect(checkCredentials("adalovelace", "adalovelace123")?.field).toBe("password");
    expect(checkCredentials("adalovelace", "ADALOVELACE123")?.field).toBe("password");
  });

  it("rejects the passwords everybody tries first", () => {
    expect(checkCredentials("someone", "password")?.field).toBe("password");
    expect(checkCredentials("someone", "12345678")?.field).toBe("password");
  });

  it("treats usernames case-insensitively so nobody can register a twin", () => {
    expect(usernameKey("  AdaLovelace ")).toBe("adalovelace");
  });
});
