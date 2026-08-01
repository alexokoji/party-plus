/**
 * Changing game without rebuilding the room.
 *
 *   npm run dev:room           (terminal 1)
 *   npm run test:switch        (terminal 2)
 *
 * A group that wants to play something else should not have to leave, make a
 * new room and re-share the code — which is what they had to do, because
 * `selectGame` is refused outside the lobby and there was no way back to it.
 * This covers the way back, and that only the host holds it.
 */
import { connect, createRoom, guest, joinAs, makeWaiters, send, wait } from "./roomClient.mjs";

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const { waitFor } = makeWaiters(failures);

const host = await guest("Ada");
const code = await createRoom(host.token);
const a = await connect(host, code);
const b = await joinAs("Bola", code);
await wait(400);
console.log(`switch: 2 players in room ${code}`);

send(a, { type: "selectGame", gameId: "liars-dice" });
await waitFor(() => a.snapshot?.gameId === "liars-dice", "first game pick");
for (const c of [a, b]) send(c, { type: "ready", ready: true });
await waitFor(() => a.snapshot?.members.every((m) => m.ready), "ready");
send(a, { type: "start" });
await waitFor(() => a.snapshot?.phase === "playing", "first start");
check(a.snapshot?.view !== null, "no view once playing");

send(a, { type: "chat", text: "playing dice" });
await waitFor(() => b.snapshot?.chat.some((m) => m.text === "playing dice"), "chat before the switch");

// A guest must not be able to end everyone's match.
b.errors.length = 0;
send(b, { type: "backToLobby" });
await wait(300);
check(b.errors.some((e) => /only the host/i.test(e)), "a non-host ended the match");
check(a.snapshot?.phase === "playing", "the match ended anyway");

// The host can, and the room survives it.
send(a, { type: "backToLobby" });
await waitFor(() => a.snapshot?.phase === "lobby", "back to the lobby");
check(a.snapshot?.members.length === 2, "the room lost members on the way back");
check(a.snapshot?.view === null, "a stale game view survived the switch");
check(a.snapshot?.members.every((m) => !m.ready), "ready state was not cleared");
check(b.snapshot?.phase === "lobby", "the other player was not told");
// The point of staying in the room is that the room's stuff stays.
check(
  a.snapshot?.chat.some((m) => m.text === "playing dice"),
  "the chat history was thrown away"
);

// A different game can now be chosen and played.
send(a, { type: "selectGame", gameId: "trivia" });
await waitFor(() => a.snapshot?.gameId === "trivia", "second game pick");
for (const c of [a, b]) send(c, { type: "ready", ready: true });
await waitFor(() => a.snapshot?.members.every((m) => m.ready), "ready again");
send(a, { type: "start" });
await waitFor(() => a.snapshot?.phase === "playing", "second start");
check(a.snapshot?.gameId === "trivia", "the new game did not start");
check(b.snapshot?.view !== null, "the second game dealt nothing to the other player");

for (const c of [a, b]) c.ws.close();
await wait(200);

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\n✓ the host can change game mid-match; members and chat survive, and only the host can");
