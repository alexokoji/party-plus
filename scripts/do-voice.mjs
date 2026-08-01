/**
 * Voice signalling through the live room Durable Object.
 *
 *   npm run dev:room      (terminal 1)
 *   npm run test:voice    (terminal 2)
 *
 * The audio itself is peer to peer and never touches the server, so what is
 * testable here is the handshake — and the part of the handshake that matters
 * is that it is ADDRESSED. An offer meant for one person must reach that
 * person and nobody else: signalling carries session descriptions, and
 * broadcasting them would let anyone in the room answer a call meant for
 * someone else.
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
const c = await joinAs("Chidi", code);
await wait(400);

console.log(`voice: 3 players in room ${code}`);
check(a.snapshot?.members.length === 3, `expected 3 members, saw ${a.snapshot?.members.length}`);

// ---- nobody is on the call until they say so ----
check(
  (a.snapshot?.members ?? []).every((m) => !m.voice?.joined),
  "somebody was on the call before anyone joined — the mic must be opt-in"
);

// ---- presence ----
send(a, { type: "voiceState", joined: true, muted: false });
await waitFor(
  () => b.snapshot?.members.find((m) => m.id === a.id)?.voice?.joined === true,
  "voice presence to reach the room"
);
send(a, { type: "voiceState", joined: true, muted: true });
await waitFor(
  () => c.snapshot?.members.find((m) => m.id === a.id)?.voice?.muted === true,
  "mute state to reach the room"
);

// ---- THE invariant: signalling is addressed, not broadcast ----
for (const client of [a, b, c]) client.voice.length = 0;
send(a, { type: "voice", to: b.id, signal: { description: { type: "offer", sdp: "v=0 SECRET-OFFER" } } });
await waitFor(() => b.voice.length > 0, "an offer to reach its addressee");

check(b.voice[0]?.from === a.id, "the relayed offer did not name its sender");
check(
  JSON.stringify(b.voice[0]?.signal ?? {}).includes("SECRET-OFFER"),
  "the offer arrived without its payload"
);
await wait(300);
check(c.voice.length === 0, "LEAK: a third party received signalling addressed to someone else");
check(a.voice.length === 0, "the sender was echoed their own offer");

// ---- answering works the other way ----
send(b, { type: "voice", to: a.id, signal: { description: { type: "answer", sdp: "v=0 ANSWER" } } });
await waitFor(() => a.voice.length > 0, "an answer to come back");
check(a.voice[0]?.from === b.id, "the answer did not name its sender");

// ---- addressing a stranger goes nowhere ----
for (const client of [a, b, c]) client.voice.length = 0;
send(a, { type: "voice", to: "u_someone_not_here", signal: { candidate: {} } });
await wait(300);
check(
  a.voice.length === 0 && b.voice.length === 0 && c.voice.length === 0,
  "signalling for a player who is not in the room was delivered to somebody"
);

// ---- leaving the room takes you off the call ----
// Bola has to actually be on the call for dropping to clear anything.
send(b, { type: "voiceState", joined: true, muted: false });
await waitFor(
  () => a.snapshot?.members.find((m) => m.id === b.id)?.voice?.joined === true,
  "Bola to appear on the call"
);
b.ws.close();
await waitFor(
  () => a.snapshot?.members.find((m) => m.id === b.id)?.voice?.joined === false,
  "a dropped socket to clear its voice presence",
  12000
);

for (const client of [a, c]) client.ws.close();
await wait(200);

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\n✓ voice signalling: addressed to one peer, never broadcast, and cleared on disconnect");
