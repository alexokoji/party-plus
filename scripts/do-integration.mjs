/**
 * End-to-end check of the generic room Durable Object over real WebSockets.
 *
 * Run against a live `wrangler dev`:
 *   npm run dev:room          (terminal 1)
 *   npm run test:do           (terminal 2)
 *
 * Unit tests cover the rules and the redaction function; only a real
 * connection proves the bytes on the wire are safe and that the game-agnostic
 * room engine drives a real module correctly.
 */
import { connect, createRoom, guest, joinAs, makeWaiters, send, wait } from "./roomClient.mjs";

const PLAYERS = ["Alice", "Bob", "Carol"];

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

/**
 * The invariant, checked on every snapshot: a seated player may only ever see
 * their own hidden state.
 */
function leakWatch(snapshot, client) {
  const id = client.id;
  const view = snapshot.view;
  if (view && snapshot.youArePlaying && !view.seesAllHands) {
    // Liar's Dice
    for (const die of view.dice ?? []) {
      if (die.ownerId !== id && die.face !== null) {
        failures.push(`LEAK: ${id} saw ${die.ownerId}'s die (${die.face})`);
      }
    }
    // Whot: opponents must be counts only, and allHands must stay empty.
    for (const opp of view.opponents ?? []) {
      const keys = Object.keys(opp).sort().join(",");
      if (keys !== "cardCount,id") failures.push(`LEAK: opponent payload for ${id} had keys ${keys}`);
    }
    if (view.allHands && Object.keys(view.allHands).length > 0) {
      failures.push(`LEAK: ${id} received allHands while still playing`);
    }
  }
  if (snapshot.gameState !== undefined) failures.push(`LEAK: raw gameState sent to ${id}`);
}

const { waitFor } = makeWaiters(failures);

/** Minimum legal raise, or a challenge — using only the redacted view. */
function decide(view) {
  const bid = view.currentBid;
  const total = view.players.reduce((s, p) => s + p.diceCount, 0);
  if (bid && (bid.quantity > total * 0.55 || Math.random() < 0.25)) return { type: "challenge" };
  if (!bid) return { type: "bid", bid: { quantity: 1, face: 2 } };
  if (view.palifico) return { type: "bid", bid: { quantity: bid.quantity + 1, face: bid.face } };
  if (bid.face !== 1 && bid.face < 6) return { type: "bid", bid: { quantity: bid.quantity, face: bid.face + 1 } };
  return { type: "bid", bid: { quantity: bid.quantity + 1, face: bid.face } };
}

// ---------- lobby ----------
const aliceIdentity = await guest(PLAYERS[0]);
const ROOM = await createRoom(aliceIdentity.token);
const clients = [await connect(aliceIdentity, ROOM, { onSnapshot: leakWatch })];
for (const name of PLAYERS.slice(1)) {
  clients.push(await joinAs(name, ROOM, { onSnapshot: leakWatch }));
}
await wait(400);
const [host, second, third] = clients;

console.log(`connected ${clients.length} clients to room ${ROOM}`);

check(host.snapshot?.phase === "lobby", "room did not start in the lobby");
check(host.snapshot?.hostId === host.id, "first joiner should be host");
check((host.snapshot?.catalog ?? []).some((g) => g.id === "liars-dice"), "catalog missing liars-dice");
check(host.snapshot?.members.length === 3, `expected 3 members, got ${host.snapshot?.members.length}`);
check(host.snapshot?.members.every((m) => m.seated), "lobby joiners should be seated by default");
check(host.snapshot?.view === null, "no game view should exist before a match starts");

// Names propagate.
check(
  host.snapshot?.members.find((m) => m.id === second.id)?.name === "Bob",
  "display name not broadcast"
);

// Only the host may pick the game.
second.errors.length = 0;
send(second, { type: "selectGame", gameId: "liars-dice" });
await wait(250);
check(second.errors.some((e) => /only the host/i.test(e)), "non-host was allowed to pick the game");

// Unknown games are refused.
host.errors.length = 0;
send(host, { type: "selectGame", gameId: "not-a-game" });
await wait(250);
check(host.errors.some((e) => /unknown game/i.test(e)), "unknown game id was accepted");

send(host, { type: "selectGame", gameId: "liars-dice" });
await waitFor(() => host.snapshot?.gameId === "liars-dice", "game selection");

// Starting requires everyone ready.
host.errors.length = 0;
send(host, { type: "start" });
await wait(250);
check(host.errors.some((e) => /ready/i.test(e)), "started without everyone ready");

// Chat and emotes are platform features, available in the lobby.
send(second, { type: "chat", text: "hello table" });
send(third, { type: "emote", emote: "🎲" });
await waitFor(
  () => host.snapshot?.chat.some((m) => m.text === "hello table") && host.snapshot.chat.some((m) => m.text === "🎲"),
  "chat and emote delivery"
);

// Third player switches to spectating; the match then has 2 seats.
send(third, { type: "spectate", spectate: true });
await waitFor(() => host.snapshot?.members.find((m) => m.id === third.id)?.seated === false, "spectate toggle");

for (const c of [host, second]) send(c, { type: "ready", ready: true });
await waitFor(
  () => host.snapshot?.members.filter((m) => m.seated).every((m) => m.ready),
  "seated players to ready up"
);

send(host, { type: "start" });
await waitFor(() => host.snapshot?.phase === "playing", "match start");

// ---------- playing ----------
check(host.snapshot?.view !== null, "no view after start");
check(host.snapshot?.youArePlaying === true, "host should be playing");
check(third.snapshot?.youArePlaying === false, "spectator should not be playing");
check(third.snapshot?.view?.seesAllHands === true, "spectator should see all hands");
check(
  host.snapshot?.view?.myDice?.length === 5,
  `host should hold 5 dice, got ${host.snapshot?.view?.myDice?.length}`
);
check(typeof host.snapshot?.turnDeadline === "number", "no turn deadline published");

// A spectator must not be able to play.
third.errors.length = 0;
send(third, { type: "move", move: { type: "bid", bid: { quantity: 1, face: 2 } } });
await wait(250);
check(third.errors.some((e) => /spectator/i.test(e)), "spectator was allowed to move");

// Out-of-turn and malformed moves are refused by the server.
const actorId = host.snapshot.currentPlayerId;
const notActor = [host, second].find((c) => c.id !== actorId);
notActor.errors.length = 0;
send(notActor, { type: "move", move: { type: "bid", bid: { quantity: 1, face: 3 } } });
await wait(250);
check(notActor.errors.some((e) => /illegal/i.test(e)), "server accepted an out-of-turn move");

const actorClient = [host, second].find((c) => c.id === actorId);
actorClient.errors.length = 0;
send(actorClient, { type: "move", move: { type: "bid", bid: { quantity: 0, face: 99 } } });
await wait(250);
check(actorClient.errors.some((e) => /illegal/i.test(e)), "server accepted a malformed move");

// Play the match out through the generic move channel.
let moves = 0;
while (moves < 800) {
  const snap = host.snapshot;
  if (!snap || snap.phase !== "playing") break;
  const actor = [host, second].find((c) => c.id === snap.currentPlayerId);
  if (!actor) break;

  const before = `${actor.snapshot.view.round}:${JSON.stringify(actor.snapshot.view.currentBid)}`;
  send(actor, { type: "move", move: decide(actor.snapshot.view) });
  moves++;
  await waitFor(
    () =>
      host.snapshot.phase !== "playing" ||
      `${host.snapshot.view.round}:${JSON.stringify(host.snapshot.view.currentBid)}` !== before,
    `move ${moves}`,
    4000
  );
}

const final = host.snapshot;
check(final?.phase === "finished", `match did not finish (phase=${final?.phase}, moves=${moves})`);
check((final?.winners ?? []).length === 1, `expected 1 winner, got ${JSON.stringify(final?.winners)}`);
check(
  (final?.view?.history?.length ?? 0) > 0,
  "history missing from the finished view (post-match report would be empty)"
);
for (const c of clients) {
  check(
    JSON.stringify(c.snapshot?.winners) === JSON.stringify(final.winners),
    `${c.id} disagrees on the winner`
  );
}
// Once the match is over every hand is public, so the reveal is expected.
check(final?.view?.seesAllHands !== undefined, "view missing seesAllHands");

// ---------- rematch ----------
second.errors.length = 0;
send(second, { type: "rematch" });
await wait(250);
check(second.errors.some((e) => /only the host/i.test(e)), "non-host was allowed to rematch");

send(host, { type: "rematch" });
await waitFor(() => host.snapshot?.phase === "playing", "rematch to deal a new match");
check(
  host.snapshot?.view?.players.every((p) => p.diceCount === 5 && !p.eliminated),
  "rematch did not restore every seat to 5 dice"
);

for (const c of clients) c.ws.close();
await wait(300);

// ---------- timeout / disconnect ----------
const timIdentity = await guest("Tim");
const TROOM = await createRoom(timIdentity.token);
const t1 = await connect(timIdentity, TROOM, { onSnapshot: leakWatch });
const t2 = await joinAs("Tina", TROOM, { onSnapshot: leakWatch });
await wait(300);
send(t1, { type: "selectGame", gameId: "liars-dice" });
await waitFor(() => t1.snapshot?.gameId === "liars-dice", "timeout-room game selection");
for (const c of [t1, t2]) send(c, { type: "ready", ready: true });
await waitFor(() => t1.snapshot?.members.every((m) => m.ready), "timeout-room ready");
send(t1, { type: "start" });
await waitFor(() => t1.snapshot?.phase === "playing", "timeout-room start");

const stalledId = t1.snapshot.currentPlayerId;
const stalled = [t1, t2].find((c) => c.id === stalledId);
const watcher = [t1, t2].find((c) => c.id !== stalledId);
const beforeRound = watcher.snapshot.view.round;
const beforeBid = JSON.stringify(watcher.snapshot.view.currentBid);
stalled.ws.close();

const moved = await waitFor(
  () =>
    watcher.snapshot.phase !== "playing" ||
    watcher.snapshot.view.round !== beforeRound ||
    JSON.stringify(watcher.snapshot.view.currentBid) !== beforeBid,
  "room to auto-play for a disconnected player",
  25000
);
check(moved, "a disconnected player froze the table (no auto-play fired)");
check(
  watcher.snapshot?.members.find((m) => m.id === stalledId)?.connected === false,
  "disconnected player not marked offline"
);
watcher.ws.close();

// ---------- host migration ----------
// If the host vanishes the room must not deadlock: nobody else could pick a
// game or start, and the host is not coming back.
const hostyIdentity = await guest("Hosty");
const HROOM = await createRoom(hostyIdentity.token);
const h1 = await connect(hostyIdentity, HROOM, { onSnapshot: leakWatch });
const h2 = await joinAs("Nexty", HROOM, { onSnapshot: leakWatch });
await wait(300);
check(h2.snapshot?.hostId === h1.id, "first joiner should start as host");

h1.ws.close();
await waitFor(() => h2.snapshot?.hostId === h2.id, "host to migrate to the remaining member", 8000);

h2.errors.length = 0;
send(h2, { type: "selectGame", gameId: "liars-dice" });
await waitFor(() => h2.snapshot?.gameId === "liars-dice", "new host to be able to pick a game");
check(!h2.errors.some((e) => /only the host/i.test(e)), "migrated host was still refused");
h2.ws.close();
await wait(200);

// ---------- Whot module through the same generic room ----------
const wandaIdentity = await guest("Wanda");
const WROOM = await createRoom(wandaIdentity.token);
const w1 = await connect(wandaIdentity, WROOM, { onSnapshot: leakWatch });
const w2 = await joinAs("Wale", WROOM, { onSnapshot: leakWatch });
await wait(300);

check((w1.snapshot?.catalog ?? []).some((g) => g.id === "whot"), "catalog missing whot");
const whotMeta = (w1.snapshot?.catalog ?? []).find((g) => g.id === "whot");
check((whotMeta?.variants ?? []).length > 1, "whot did not advertise rule variants");

send(w1, { type: "selectGame", gameId: "whot" });
await waitFor(() => w1.snapshot?.gameId === "whot", "whot selection");

// Pick a non-default variant to prove room options reach the module.
send(w1, { type: "setGameOptions", options: { variant: "british-waddingtons" } });
await waitFor(() => w1.snapshot?.gameOptions?.variant === "british-waddingtons", "variant selection");

// A non-host must not be able to change the rules.
w2.errors.length = 0;
send(w2, { type: "setGameOptions", options: { variant: "old-school" } });
await wait(250);
check(w2.errors.some((e) => /only the host/i.test(e)), "non-host changed the rules");

for (const c of [w1, w2]) send(c, { type: "ready", ready: true });
await waitFor(() => w1.snapshot?.members.every((m) => m.ready), "whot ready-up");
send(w1, { type: "start" });
await waitFor(() => w1.snapshot?.phase === "playing", "whot match start");

check(w1.snapshot?.view?.rulesId === "british-waddingtons", `variant not applied: ${w1.snapshot?.view?.rulesId}`);
check(w1.snapshot?.view?.myHand?.length === 6, `expected 6 cards, got ${w1.snapshot?.view?.myHand?.length}`);
check(
  (w1.snapshot?.view?.opponents ?? []).every((o) => o.cardCount === 6),
  "opponent card counts wrong at deal"
);
check(w1.snapshot?.view?.topCard?.shape !== "whot", "match opened on a wildcard");

let wmoves = 0;
while (wmoves < 1500) {
  const snap = w1.snapshot;
  if (!snap || snap.phase !== "playing") break;
  const actor = [w1, w2].find((c) => c.id === snap.currentPlayerId);
  if (!actor) break;
  const v = actor.snapshot.view;
  const playableId = v.playableCardIds[0];
  let move;
  if (playableId) {
    const card = v.myHand.find((c) => c.id === playableId);
    move =
      card?.shape === "whot"
        ? { type: "play", cardId: playableId, requestShape: "circle" }
        : { type: "play", cardId: playableId };
  } else {
    move = { type: "draw" };
  }
  const before = `${v.myHand.length}:${JSON.stringify(v.topCard)}:${snap.currentPlayerId}`;
  send(actor, { type: "move", move });
  wmoves++;
  await waitFor(
    () => {
      const s2 = w1.snapshot;
      if (!s2 || s2.phase !== "playing") return true;
      const me = [w1, w2].find((c) => c.id === actor.id);
      return `${me.snapshot.view.myHand.length}:${JSON.stringify(me.snapshot.view.topCard)}:${s2.currentPlayerId}` !== before;
    },
    `whot move ${wmoves}`,
    4000
  );
}

const wfinal = w1.snapshot;
check(wfinal?.phase === "finished", `whot did not finish (phase=${wfinal?.phase}, moves=${wmoves})`);
check((wfinal?.winners ?? []).length > 0, "whot recorded no winner");

for (const c of [w1, w2]) c.ws.close();
await wait(200);

console.log(`\nmoves played: ${moves}`);
console.log(`whot moves played: ${wmoves} (winners ${JSON.stringify(wfinal?.winners)})`);
console.log(`winners: ${JSON.stringify(final?.winners)}`);
console.log(`messages: ${clients.map((c) => `${c.id}=${c.messages}`).join(", ")}`);

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\n✓ generic room engine + Liar's Dice module: all integration checks passed");
console.log("  (no hidden dice reached any non-owner; no raw game state left the server)");
