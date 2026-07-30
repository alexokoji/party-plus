/**
 * The security boundary, tested against a live Worker.
 *
 *   npm run dev:room        (terminal 1)
 *   npm run test:security   (terminal 2)
 *
 * Everything here is about the two questions the platform used not to ask:
 * *who is this*, and *are they going too fast*. The unit tests cover the
 * primitives; only a real socket proves the server actually refuses.
 */
import WebSocket from "ws";
import { HTTP, WS, connect, createRoom, guest, joinAs, makeWaiters, post, send, wait } from "./roomClient.mjs";

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const { waitFor } = makeWaiters(failures);

// ================= identity =================
const alice = await guest("Alice");
const mallory = await guest("Mallory");

check(alice.id !== mallory.id, "two guests got the same player id");
check(alice.token !== mallory.token, "two guests got the same token");
check(alice.id.startsWith("g_"), `guest id looks wrong: ${alice.id}`);
console.log(`identity: two guests issued distinct signed tokens`);

// A token nobody signed is worthless.
const forged = await post("/rooms", {}, "not.a.real.token");
check(forged.status === 401, `a forged token was accepted (${forged.status})`);

// So is a token with an edited payload.
const [body, sig] = alice.token.split(".");
const tampered = Buffer.from(JSON.stringify({ sub: "g_someone_else", name: "Alice", kind: "guest", iat: Date.now(), exp: Date.now() + 1e9 }))
  .toString("base64url");
const edited = await post("/rooms", {}, `${tampered}.${sig}`);
check(edited.status === 401, `an edited token was accepted (${edited.status})`);
console.log(`identity: forged and edited tokens refused`);

// ================= room codes =================
const code = await createRoom(alice.token);
check(code.length === 8, `expected an 8-character code, got ${code.length}: ${code}`);
check(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code), `code has unexpected characters: ${code}`);

const codes = new Set();
for (let i = 0; i < 5; i++) codes.add(await createRoom(alice.token));
check(codes.size === 5, "room codes repeated");
console.log(`room codes: 8 characters, minted server-side (${code})`);

// Creating a room requires an identity at all.
const anonymous = await post("/rooms", {});
check(anonymous.status === 401, `an anonymous caller created a room (${anonymous.status})`);

// THE fix for enumeration: a code nobody created does not exist.
const probe = await post(`/rooms/ZZZZZZZZ/ticket`, {}, alice.token);
check(probe.status === 404, `probing an uncreated room returned ${probe.status}, not 404`);
check(!probe.data.ticket, "probing an uncreated room handed out a ticket");
console.log(`room codes: an uninvented code is a 404, so guessing has a wrong answer`);

// ================= socket auth =================
// No ticket at all.
const naked = new WebSocket(`${WS}/room/${code}`);
const nakedClosed = await new Promise((resolve) => {
  naked.on("error", () => resolve("rejected"));
  naked.on("unexpected-response", (_req, res) => resolve(res.statusCode));
  naked.on("open", () => resolve("opened"));
});
check(nakedClosed !== "opened", "a socket opened with no ticket at all");
console.log(`socket: refused without a ticket (${nakedClosed})`);

// The old attack, end to end: claim someone else's player id.
const impersonation = new WebSocket(`${WS}/room/${code}?playerId=${encodeURIComponent(alice.id)}`);
const impersonationResult = await new Promise((resolve) => {
  impersonation.on("error", () => resolve("rejected"));
  impersonation.on("unexpected-response", (_req, res) => resolve(res.statusCode));
  impersonation.on("open", () => resolve("opened"));
});
check(impersonationResult !== "opened", "IMPERSONATION: a claimed playerId still opens a socket");
console.log(`socket: a claimed playerId no longer works (${impersonationResult})`);

// A ticket is good for exactly one room.
const other = await createRoom(mallory.token);
const ticketForOther = await post(`/rooms/${other}/ticket`, {}, mallory.token);
const wrongRoom = new WebSocket(`${WS}/room/${code}?ticket=${encodeURIComponent(ticketForOther.data.ticket)}`);
const wrongRoomResult = await new Promise((resolve) => {
  wrongRoom.on("error", () => resolve("rejected"));
  wrongRoom.on("unexpected-response", (_req, res) => resolve(res.statusCode));
  wrongRoom.on("open", () => resolve("opened"));
});
check(wrongRoomResult !== "opened", "a ticket for one room opened a different room");
console.log(`socket: a ticket for another room is refused (${wrongRoomResult})`);

// And the happy path still works.
const host = await connect(alice, code);
check(host.snapshot?.members.some((m) => m.id === alice.id), "the ticket holder did not join their own room");
console.log(`socket: the ticket holder joins normally`);

// ================= host controls =================
const guestPlayer = await joinAs("Bola", code);
await waitFor(() => host.snapshot?.members.length === 2, "the second player to appear");

// Lock: no new joiners.
send(host, { type: "lock", locked: true });
await waitFor(() => host.snapshot?.locked === true, "the room to lock");
let lockedOut = null;
try {
  await joinAs("Chidi", code);
  lockedOut = "joined";
} catch (e) {
  lockedOut = "refused";
}
check(lockedOut === "refused", "someone joined a locked room");

// A member who reloads still gets back in.
const rejoin = await connect(guestPlayer, code).catch(() => null);
check(rejoin !== null, "a locked room shut out one of its own members");
console.log(`host controls: locked out a newcomer, let an existing member reconnect`);

send(host, { type: "lock", locked: false });
await waitFor(() => host.snapshot?.locked === false, "the room to unlock");

// Only the host may lock or kick.
guestPlayer.errors.length = 0;
send(guestPlayer, { type: "lock", locked: true });
send(guestPlayer, { type: "kick", playerId: alice.id });
await wait(300);
check(guestPlayer.errors.filter((e) => /only the host/i.test(e)).length === 2, "a non-host locked or kicked");

// Kick, and stay kicked.
send(host, { type: "kick", playerId: guestPlayer.id });
await waitFor(() => host.snapshot?.members.length === 1, "the kicked player to leave");
let returned = null;
try {
  await connect(guestPlayer, code);
  returned = "rejoined";
} catch {
  returned = "refused";
}
check(returned === "refused", "a kicked player walked straight back in");
console.log(`host controls: kicked a player, who cannot return`);

// ================= rate limiting =================
// Chat: a burst is allowed, a flood is not.
host.errors.length = 0;
for (let i = 0; i < 40; i++) send(host, { type: "chat", text: `flood ${i}` });
await wait(600);
check(host.errors.some((e) => /slow down/i.test(e)), "chat flooding was never refused");
const delivered = host.snapshot.chat.filter((m) => m.text?.startsWith("flood ")).length;
check(delivered < 40, `every message of a 40-message flood was delivered (${delivered})`);
console.log(`rate limiting: ${delivered}/40 flood messages accepted, the rest refused`);

// Moves have their own bucket, so chat spam does not disarm the game.
host.errors.length = 0;
send(host, { type: "selectGame", gameId: "liars-dice" });
await wait(300);
check(!host.errors.some((e) => /slow down/i.test(e)), "a normal action was caught by the chat flood");

// ================= accounts =================
const username = `tester_${Date.now().toString().slice(-8)}`;
const registered = await post("/auth/register", { username, password: "a-decent-password", token: alice.token });
check(registered.ok, `registration failed: ${registered.data.error}`);
// The guest keeps their id, so an account can be claimed mid-game.
check(registered.data.user.id === alice.id, "registering as a guest did not keep the player id");
check(!JSON.stringify(registered.data).includes("password"), "LEAK: the registration reply mentioned the password");
check(!JSON.stringify(registered.data).includes("pbkdf2"), "LEAK: the password hash was sent to the client");
console.log(`accounts: ${username} registered, keeping the guest's player id`);

const taken = await post("/auth/register", { username: username.toUpperCase(), password: "another-password" });
check(taken.status === 409, `a username was registered twice in different case (${taken.status})`);

const weak = await post("/auth/register", { username: `weak_${Date.now().toString().slice(-6)}`, password: "short" });
check(weak.status === 400, "a five-character password was accepted");

const wrongPassword = await post("/auth/login", { username, password: "not-the-password" });
check(wrongPassword.status === 401, `a wrong password logged in (${wrongPassword.status})`);
check(
  !/no such user|unknown user|does not exist/i.test(wrongPassword.data.error ?? ""),
  `the error distinguishes a missing account from a wrong password: ${wrongPassword.data.error}`
);

const goodLogin = await post("/auth/login", { username, password: "a-decent-password" });
check(goodLogin.ok, `a correct password failed to log in: ${goodLogin.data.error}`);
check(goodLogin.data.user.id === alice.id, "logging in returned a different player id");
console.log(`accounts: wrong password refused, right password returns the same identity`);

// Five wrong passwords locks the account for a while.
for (let i = 0; i < 6; i++) await post("/auth/login", { username, password: `wrong-${i}` });
const locked = await post("/auth/login", { username, password: "a-decent-password" });
check(locked.status === 429, `the account did not lock after repeated failures (${locked.status})`);
check(/try again/i.test(locked.data.error ?? ""), "the lockout gives no hint when to return");
console.log(`accounts: locked after repeated failures, even for the right password`);

// Login attempts are limited per IP.
//
// Deliberately last: this drains the shared per-IP bucket, so anything after
// it would be refused for the wrong reason. That is the limiter working, but
// it makes for a misleading test.
let refused = 0;
for (let i = 0; i < 15; i++) {
  const attempt = await post("/auth/login", { username: "nobody_here", password: "wrong-password-x" });
  if (attempt.status === 429) refused++;
}
check(refused > 0, "unlimited login attempts were allowed");
console.log(`rate limiting: login refused after repeated attempts (${refused}/15 blocked)`);

host.ws.close();
await wait(200);

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\n✓ security boundary: all checks passed");
console.log("  (identity is signed, not claimed; codes are minted and unguessable;");
console.log("   tickets are room-scoped; hosts can lock and remove; floods are refused)");
