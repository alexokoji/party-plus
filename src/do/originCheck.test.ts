import { describe, it, expect } from "vitest";
import { originAllowed } from "./index";
import type { Env } from "./RoomDO";

/**
 * The origin allow-list is the only thing standing between the deployed Worker
 * and anyone else's website running their traffic through it — WebSocket
 * upgrades get no CORS protection for free.
 */
const env = (ALLOWED_ORIGINS?: string) => ({ ALLOWED_ORIGINS } as Env);
const from = (origin?: string) =>
  new Request("https://room.example.workers.dev/room/ABCD", {
    headers: origin ? { Origin: origin } : {},
  });

describe("origin allow-list", () => {
  it("allows anything when unset — local dev and private tests", () => {
    expect(originAllowed(from("https://anywhere.example"), env())).toBe(true);
    expect(originAllowed(from("https://anywhere.example"), env(""))).toBe(true);
    expect(originAllowed(from("https://anywhere.example"), env("   "))).toBe(true);
  });

  it("allows the configured origin", () => {
    expect(originAllowed(from("https://party.vercel.app"), env("https://party.vercel.app"))).toBe(true);
  });

  it("refuses an origin that is not on the list", () => {
    expect(originAllowed(from("https://evil.example"), env("https://party.vercel.app"))).toBe(false);
  });

  it("accepts several origins, so preview deploys keep working", () => {
    const list = "https://party.vercel.app, https://party-git-main.vercel.app";
    expect(originAllowed(from("https://party-git-main.vercel.app"), env(list))).toBe(true);
    expect(originAllowed(from("https://evil.example"), env(list))).toBe(false);
  });

  it("ignores a trailing slash on either side", () => {
    expect(originAllowed(from("https://party.vercel.app"), env("https://party.vercel.app/"))).toBe(true);
  });

  it("does not match a lookalike origin", () => {
    const list = "https://party.vercel.app";
    expect(originAllowed(from("https://party.vercel.app.evil.example"), env(list))).toBe(false);
    expect(originAllowed(from("http://party.vercel.app"), env(list))).toBe(false);
  });

  it("lets a non-browser client through, which is how the test scripts connect", () => {
    expect(originAllowed(from(), env("https://party.vercel.app"))).toBe(true);
  });
});
