/**
 * End-to-end check of the Dominoes and Werewolf modules through the real room
 * Durable Object.
 *
 * Run against a live `wrangler dev`:
 *   npm run dev:room             (terminal 1)
 *   npm run test:new-games       (terminal 2)
 *
 * These two modules carry the platform's hardest hidden-information cases:
 * dominoes hides tiles despite being a "board" game, and werewolf hides roles
 * from everyone including the dead. Unit tests cover the redaction functions;
 * only a live socket proves the bytes on the wire are safe.
 */
import WebSocket from "ws";

const PORT = process.env.ROOM_PORT ?? "8787";
const STAMP = Date.now().toString().slice(-6);

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const ROLE_NAMES = ["villager", "werewolf", "seer", "doctor", "hunter", "witch"];

function connect({ id, name }, room) {
  const q = `playerId=${encodeURIComponent(id)}&name=${encodeURIComponent(name ?? "")}`;
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/room/${room}?${q}`);
  const client = { id, name, ws, snapshot: null, errors: [], events: [] };

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "error") return client.errors.push(msg.message);
    client.snapshot = msg.snapshot;
    for (const e of msg.snapshot.events ?? []) client.events.push(e);

    if (msg.snapshot.gameState !== undefined) failures.push(`LEAK: raw gameState sent to ${id}`);

    const view = msg.snapshot.view;
    if (!view) return;
    const wire = JSON.stringify(view);

    // ---- Dominoes: tiles in hand are hidden information.
    if (msg.snapshot.gameId === "dominoes" && msg.snapshot.youArePlaying && !view.seesAllHands) {
      for (const opp of view.opponents ?? []) {
        const keys = Object.keys(opp).sort().join(",");
        if (keys !== "id,tileCount") failures.push(`LEAK: dominoes opponent payload for ${id}: ${keys}`);
      }
      if (Object.keys(view.allHands ?? {}).length > 0) {
        failures.push(`LEAK: ${id} received allHands while still playing dominoes`);
      }
    }

    // ---- Werewolf: roles are hidden from EVERYONE until the game ends,
    // including the dead and spectators.
    if (msg.snapshot.gameId === "werewolf") {
      for (const p of view.players ?? []) {
        const keys = Object.keys(p).sort().join(",");
        if (keys !== "accusedBy,alive,hasVoted,id") {
          failures.push(`LEAK: werewolf public player payload for ${id}: ${keys}`);
        }
      }
      if (!view.finished) {
        if (view.revealedRoles !== null) failures.push(`LEAK: ${id} got revealedRoles mid-game`);
        // The only role name allowed on the wire is this recipient's own.
        const mine = view.me?.role ?? null;
        for (const role of ROLE_NAMES) {
          if (role === mine) continue;
          if (wire.includes(`"role":"${role}"`)) {
            failures.push(`LEAK: ${id} (role ${mine}) saw role "${role}" on the wire`);
          }
        }
        // Nobody's night choice or vote but their own.
        if (wire.includes('"nightChoice"') && !view.me) {
          failures.push(`LEAK: spectator ${id} received a nightChoice`);
        }
      }
    }
  });

  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve(client));
    ws.on("error", reject);
  });
}

const send = (c, msg) => c.ws.send(JSON.stringify(msg));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Like waitFor, but a miss is not a failure — for retryable, clock-driven steps. */
async function poll(predicate, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await wait(50);
  }
  return false;
}

async function waitFor(predicate, label, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await wait(50);
  }
  failures.push(`TIMEOUT waiting for ${label}`);
  return false;
}

async function seat(room, players, gameId, options) {
  const clients = [];
  for (const p of players) clients.push(await connect(p, room));
  await wait(400);
  const host = clients[0];
  send(host, { type: "selectGame", gameId });
  await waitFor(() => host.snapshot?.gameId === gameId, `${gameId} selection`);
  if (options) {
    send(host, { type: "setGameOptions", options });
    await waitFor(
      () => JSON.stringify(host.snapshot?.gameOptions ?? {}).includes(Object.values(options)[0]),
      `${gameId} options`
    );
  }
  for (const c of clients) send(c, { type: "ready", ready: true });
  await waitFor(() => host.snapshot?.members.filter((m) => m.seated).every((m) => m.ready), `${gameId} ready`);
  send(host, { type: "start" });
  await waitFor(() => host.snapshot?.phase === "playing", `${gameId} start`);
  return clients;
}

// ================= Dominoes =================
const DROOM = `DM${STAMP}`;
const dom = await seat(
  DROOM,
  [
    { id: "dora", name: "Dora" },
    { id: "dele", name: "Dele" },
    { id: "duke", name: "Duke" },
  ],
  "dominoes",
  { variant: "draw" }
);
const [d1] = dom;
console.log(`dominoes: 3 players seated in ${DROOM}`);

check(d1.snapshot?.view?.rulesId === "draw", `dominoes variant not applied: ${d1.snapshot?.view?.rulesId}`);
check(d1.snapshot?.view?.myHand?.length === 7, `expected 7 tiles, got ${d1.snapshot?.view?.myHand?.length}`);
check(
  (d1.snapshot?.view?.opponents ?? []).every((o) => o.tileCount === 7),
  "dominoes opponent tile counts wrong at deal"
);
// 28 tiles, 21 dealt: 7 left in the boneyard.
check(d1.snapshot?.view?.boneyardCount === 7, `boneyard should hold 7, got ${d1.snapshot?.view?.boneyardCount}`);

// Out-of-turn play is refused by the server, not the client.
const domIdle = dom.find((c) => c.id !== d1.snapshot.currentPlayerId);
domIdle.errors.length = 0;
send(domIdle, { type: "move", move: { type: "play", tileId: domIdle.snapshot.view.myHand[0].id, end: "left" } });
await wait(250);
check(domIdle.errors.some((e) => /illegal/i.test(e)), "dominoes accepted an out-of-turn play");

let dmoves = 0;
while (dmoves < 600) {
  const snap = d1.snapshot;
  if (!snap || snap.phase !== "playing") break;
  const actor = dom.find((c) => c.id === snap.currentPlayerId);
  if (!actor) break;
  const v = actor.snapshot.view;

  let move;
  if (v.playable.length > 0) {
    const pick = v.playable[0];
    move = { type: "play", tileId: pick.tileId, end: pick.ends[0] };
  } else if (v.canDraw) {
    move = { type: "draw" };
  } else {
    move = { type: "pass" };
  }

  const before = `${v.layout.length}:${v.myHand.length}:${snap.currentPlayerId}`;
  send(actor, { type: "move", move });
  dmoves++;
  await waitFor(
    () => {
      const s2 = d1.snapshot;
      if (!s2 || s2.phase !== "playing") return true;
      const me = dom.find((c) => c.id === actor.id);
      return `${me.snapshot.view.layout.length}:${me.snapshot.view.myHand.length}:${s2.currentPlayerId}` !== before;
    },
    `dominoes move ${dmoves}`,
    4000
  );
}

const dfinal = d1.snapshot;
check(dfinal?.phase === "finished", `dominoes did not finish (phase=${dfinal?.phase}, moves=${dmoves})`);
check((dfinal?.winners ?? []).length > 0, "dominoes recorded no winner");
check(
  ["emptyHand", "blocked"].includes(dfinal?.view?.endReason),
  `dominoes end reason missing: ${dfinal?.view?.endReason}`
);
// Every tile in the chain must match its neighbour — the layout on the wire has
// to be a legal chain, not just a list.
const layout = dfinal?.view?.layout ?? [];
for (let i = 1; i < layout.length; i++) {
  if (layout[i - 1].right !== layout[i].left) {
    failures.push(`dominoes chain broken at ${i}: ${layout[i - 1].right} != ${layout[i].left}`);
  }
}
// Hands are public once the game is over.
check(Object.keys(dfinal?.view?.allHands ?? {}).length > 0, "dominoes did not reveal hands at the end");

for (const c of dom) c.ws.close();
await wait(200);

// ================= Werewolf =================
const WROOM = `WW${STAMP}`;
const names = ["wanda", "wole", "wumi", "wera", "wisi"];
const wolf = await seat(
  WROOM,
  names.map((id) => ({ id, name: id })),
  "werewolf",
  { variant: "quick" }
);
const [g1] = wolf;
console.log(`werewolf: 5 players seated in ${WROOM}`);

check(g1.snapshot?.view?.rulesId === "quick", `werewolf variant not applied: ${g1.snapshot?.view?.rulesId}`);
check(g1.snapshot?.view?.phase === "night", `werewolf should open at night, got ${g1.snapshot?.view?.phase}`);
check(g1.snapshot?.view?.players?.length === 5, "werewolf seat count wrong");
check(typeof g1.snapshot?.turnDeadline === "number", "no phase deadline published to the room");

// Each player learns exactly one role: their own.
const roles = Object.fromEntries(wolf.map((c) => [c.id, c.snapshot.view.me.role]));
console.log(`roles (from each player's own view): ${JSON.stringify(roles)}`);
check(Object.values(roles).filter((r) => r === "werewolf").length === 1, "5 players should get 1 wolf");
check(Object.values(roles).includes("seer"), "no seer dealt");
check(Object.values(roles).includes("doctor"), "no doctor dealt");

// Wolves see their pack; nobody else sees allies.
for (const c of wolf) {
  const allies = c.snapshot.view.me.allies;
  if (roles[c.id] !== "werewolf") check(allies.length === 0, `${c.id} (${roles[c.id]}) was shown allies`);
}

// A villager cannot act at night, and the server enforces it.
const plainVillager = wolf.find((c) => roles[c.id] === "villager");
plainVillager.errors.length = 0;
send(plainVillager, {
  type: "move",
  move: { type: "nightAction", targetId: wolf.find((c) => c.id !== plainVillager.id).id },
});
await wait(250);
check(plainVillager.errors.some((e) => /illegal/i.test(e)), "werewolf let a villager act at night");

// The wolf cannot eat itself.
const theWolf = wolf.find((c) => roles[c.id] === "werewolf");
theWolf.errors.length = 0;
send(theWolf, { type: "move", move: { type: "nightAction", targetId: theWolf.id } });
await wait(250);
check(theWolf.errors.some((e) => /illegal/i.test(e)), "the wolf was allowed to target itself");

// Play the night: every role that acts, acts. That ends the phase early —
// without waiting out the clock.
for (const c of wolf) {
  const v = c.snapshot.view;
  if (!v.canAct || v.targets.length === 0) continue;
  send(c, { type: "move", move: { type: "nightAction", targetId: v.targets[0] } });
  await wait(150);
}
await waitFor(() => g1.snapshot?.view?.phase !== "night", "night to resolve once every actor has acted", 8000);
check(g1.snapshot?.view?.phase === "day", `expected day after the night, got ${g1.snapshot?.view?.phase}`);
check(g1.snapshot?.view?.history?.length === 1, "no round summary after the first night");

// No public event may name the wolf or its victim.
const nightEvents = g1.events.filter((e) => e.type === "nightActed");
check(nightEvents.length > 0, "no night event reached the table at all");
for (const e of nightEvents) {
  const text = JSON.stringify(e);
  for (const id of names) {
    if (text.includes(id)) failures.push(`LEAK: night event named ${id}: ${text}`);
  }
}

// Accusations are public and free to change.
const alive = () => g1.snapshot.view.players.filter((p) => p.alive).map((p) => p.id);
const accuser = wolf.find((c) => alive().includes(c.id));
const accused = alive().find((id) => id !== accuser.id);
send(accuser, { type: "move", move: { type: "accuse", targetId: accused } });
await waitFor(
  () => g1.snapshot.view.players.find((p) => p.id === accused)?.accusedBy.includes(accuser.id),
  "accusation to be published"
);

// The day only ends on the module's clock — this proves the Room DO alarm is
// actually driving the module's phase machine, which nothing else tests.
const dayEnds = g1.snapshot.view.phaseEndsAt;
console.log(`waiting out the quick-variant day (~${Math.ceil((dayEnds - Date.now()) / 1000)}s) to test the DO alarm…`);
await waitFor(() => g1.snapshot?.view?.phase === "vote", "the DO alarm to move the day on to voting", 90_000);
check(g1.snapshot?.view?.phase === "vote", `alarm did not open voting (phase=${g1.snapshot?.view?.phase})`);

// Dead players may not vote.
const ghost = wolf.find((c) => !alive().includes(c.id));
if (ghost) {
  check(ghost.snapshot.view.me.alive === false, "dead player not marked dead in their own view");
  check(ghost.snapshot.view.revealedRoles === null, "LEAK: a ghost was shown the role list");
  ghost.errors.length = 0;
  send(ghost, { type: "move", move: { type: "vote", targetId: alive()[0] } });
  await wait(250);
  check(ghost.errors.some((e) => /illegal/i.test(e)), "a dead player was allowed to vote");
}

/**
 * Everyone alive votes for the same target: that player must be lynched.
 *
 * The vote phase is on a clock, so a slow attempt can have the phase move on
 * underneath it — that is the game working, not a bug, but it proves nothing.
 * Retry on the next vote phase instead, and report the timing if it keeps
 * slipping rather than quietly passing.
 */
async function unanimousLynch(attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (g1.snapshot.phase === "finished") return { finished: true };
    if (g1.snapshot.view.phase !== "vote") {
      // Waits out a night (resolved by the clock, since nobody acts) and a day.
      const ok = await poll(
        () => g1.snapshot.view.phase === "vote" || g1.snapshot.phase === "finished",
        150_000
      );
      if (!ok) return { slipped: true, left: 0 };
      if (g1.snapshot.phase === "finished") return { finished: true };
    }

    const round = g1.snapshot.view.round;
    const left = g1.snapshot.view.phaseEndsAt - Date.now();
    const target = alive()[0];
    console.log(`vote attempt ${attempt}: round ${round}, ${Math.round(left / 1000)}s on the clock`);

    for (const c of wolf) {
      if (!alive().includes(c.id)) continue;
      c.errors.length = 0;
      send(c, { type: "move", move: { type: "vote", targetId: target } });
      await wait(120);
    }
    await poll(
      () =>
        g1.snapshot.phase === "finished" ||
        g1.snapshot.view.history.some((r) => r.round === round && r.lynched !== null),
      8000
    );
    // The lynch and the next phase land in the same broadcast, so let the
    // snapshot settle before reading rather than racing it.
    await wait(300);
    if (g1.snapshot.phase === "finished") return { finished: true, target };

    const lynched = g1.snapshot.view.history.find((r) => r.round === round)?.lynched;
    if (lynched === target) return { lynched, target, round };

    const rejected = wolf.flatMap((c) => c.errors);
    console.log(
      `  vote did not land (lynched=${lynched}); ${rejected.length} move(s) refused: ${JSON.stringify(rejected)}`
    );
  }
  return { slipped: true };
}

const voteResult = await unanimousLynch();
console.log(
  `after voting: round ${g1.snapshot.view.round}, phase ${g1.snapshot.view.phase}, ` +
    `history ${JSON.stringify(g1.snapshot.view.history)}`
);
check(
  voteResult.finished || voteResult.lynched === voteResult.target,
  `a unanimous vote never lynched its target: ${JSON.stringify(voteResult)}`
);

// Roles are only published once the game is over.
if (g1.snapshot.phase === "finished") {
  check(
    Object.keys(g1.snapshot.view.revealedRoles ?? {}).length === 5,
    "finished werewolf game did not reveal every role"
  );
  console.log(`werewolf finished early: ${JSON.stringify(g1.snapshot.winners)} (${g1.snapshot.view.winningTeam})`);
} else {
  check(g1.snapshot.view.revealedRoles === null, "LEAK: roles revealed while the game continues");
  console.log(`werewolf still running at round ${g1.snapshot.view.round}, phase ${g1.snapshot.view.phase}`);
}

for (const c of wolf) c.ws.close();
await wait(300);

console.log(`\ndominoes moves: ${dmoves}, winners ${JSON.stringify(dfinal?.winners)} (${dfinal?.view?.endReason})`);

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\n✓ Dominoes + Werewolf through the live room DO: all integration checks passed");
console.log("  (no tile left its owner's hand; no role reached anyone but its holder, dead or alive)");
