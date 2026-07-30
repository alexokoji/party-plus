/**
 * Post-deploy smoke test against the real deployment.
 *
 *   node scripts/prod-smoke.mjs https://party-plus-room.<subdomain>.workers.dev
 *
 * Deliberately small: two players, one room, one match started. It answers the
 * question a green deploy does not — whether the pieces talk to each other in
 * production, where the Durable Objects, the migrations and the signing secret
 * are all different from the ones on a laptop.
 */
import WebSocket from "ws";

const base = (process.argv[2] ?? "https://party-plus-room.alexanderokoji.workers.dev").replace(/\/$/, "");
const ws = base.replace(/^http/, "ws");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, ok: response.ok, data: await response.json().catch(() => ({})) };
}

async function connect(identity, code) {
  const ticket = await post(`/rooms/${code}/ticket`, { name: identity.name }, identity.token);
  if (!ticket.ok) throw new Error(`ticket refused (${ticket.status}): ${ticket.data.error}`);
  const socket = new WebSocket(`${ws}/room/${code}?ticket=${encodeURIComponent(ticket.data.ticket)}`);
  const client = { ...identity, ws: socket, snapshot: null, errors: [] };
  socket.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "error") return client.errors.push(msg.message);
    if (msg.type === "snapshot") client.snapshot = msg.snapshot;
  });
  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
  for (let i = 0; i < 100 && !client.snapshot; i++) await wait(50);
  return client;
}

const send = (c, msg) => c.ws.send(JSON.stringify(msg));

/**
 * Waits for a condition instead of guessing at a sleep.
 *
 * Fixed delays that are generous on a laptop are not generous against a real
 * edge network, and a smoke test that fails intermittently teaches people to
 * ignore it.
 */
async function waitFor(predicate, label, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await wait(100);
  }
  failures.push(`TIMEOUT waiting for ${label}`);
  return false;
}

const health = await fetch(`${base}/health`).then((r) => r.json());
check(health.ok === true, `health check failed: ${JSON.stringify(health)}`);
console.log(`health: ${JSON.stringify(health)}`);

const one = await post("/auth/guest", { name: "Smoke One" });
const two = await post("/auth/guest", { name: "Smoke Two" });
check(one.ok && two.ok, "could not get guest identities");
check(one.data.user.id !== two.data.user.id, "two guests share an id");

const alice = { token: one.data.token, id: one.data.user.id, name: "Smoke One" };
const bola = { token: two.data.token, id: two.data.user.id, name: "Smoke Two" };

const created = await post("/rooms", {}, alice.token);
check(created.status === 201, `room creation failed (${created.status}): ${created.data.error}`);
const code = created.data.code;
check(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code ?? ""), `bad room code: ${code}`);

// The enumeration guard, in production.
const probe = await post("/rooms/ZZZZZZZZ/ticket", {}, alice.token);
check(probe.status === 404, `probing a made-up code returned ${probe.status}, not 404`);

const hostClient = await connect(alice, code);
const guestClient = await connect(bola, code);
await waitFor(() => hostClient.snapshot?.members.length === 2, "both players to appear");

check(hostClient.snapshot?.members.length === 2, `expected 2 members, saw ${hostClient.snapshot?.members.length}`);
check(hostClient.snapshot?.hostId === alice.id, "the room creator is not the host");
check((hostClient.snapshot?.catalog ?? []).length >= 13, "the catalog is short");

send(hostClient, { type: "selectGame", gameId: "liars-dice" });
await waitFor(() => hostClient.snapshot?.gameId === "liars-dice", "the game to be selected");

for (const c of [hostClient, guestClient]) send(c, { type: "ready", ready: true });
await waitFor(
  () => hostClient.snapshot?.members.filter((m) => m.seated).every((m) => m.ready),
  "both players to ready up"
);

send(hostClient, { type: "start" });
await waitFor(() => hostClient.snapshot?.phase === "playing", "the match to start");

check(hostClient.snapshot?.phase === "playing", `match did not start (${hostClient.snapshot?.phase})`);
check(hostClient.snapshot?.view?.myDice?.length === 5, "the host was not dealt dice");

// The invariant, in production: nobody else's dice.
const foreign = (hostClient.snapshot?.view?.dice ?? []).filter(
  (d) => d.ownerId !== alice.id && d.face !== null
);
check(foreign.length === 0, `LEAK: ${foreign.length} of another player's dice reached the host`);

console.log(`room ${code}: 2 players seated, Liar's Dice started, hidden dice stayed hidden`);

// ---- accounts, which only guests exercised before ----
//
// This is here because it was missed once: password hashing threw in
// production and nowhere else, because the Workers runtime caps PBKDF2
// iterations and local `wrangler dev` does not. Every registration 500'd and
// a guest-only smoke test sailed straight past it.
const stamp = Date.now().toString().slice(-8);
const account = await post("/auth/register", {
  username: `smoke_${stamp}`,
  password: "a-decent-password",
  // Resend's simulator inbox: a real send, delivered to nobody. Plus-addressed
  // so each run is a distinct account — an address can only be registered once.
  email: `delivered+${stamp}@resend.dev`,
});
check(account.status === 200, `registration failed (${account.status}): ${account.data.error}`);
check(!!account.data.token, "registration returned no session");

const signIn = await post("/auth/login", { username: `smoke_${stamp}`, password: "a-decent-password" });
check(signIn.ok, `sign-in failed (${signIn.status}): ${signIn.data.error}`);
check(signIn.data.user?.id === account.data.user?.id, "signing in produced a different player");

// Three distinct states, and only one of them means real users get mail:
//   devLink   → no provider configured; links are logged, not sent
//   restricted → a provider took it, but a shared test sending domain means
//                only the provider account owner will ever receive it
//   neither    → actually delivered to whoever asked
const delivery = account.data.verification ?? {};
const state = delivery.devLink
  ? "NOT configured — links logged, not sent"
  : delivery.restricted
    ? "ACCEPTED BUT UNDELIVERABLE — test sending domain, only the account owner receives it"
    : "sent for real";
console.log(`accounts: registered and signed in — email ${state}`);
// Not a failure: a deployment can be perfectly healthy without mail. It is
// reported loudly because it is invisible everywhere else.
if (delivery.restricted) {
  console.log("           → verify your own domain with the provider to reach real users");
}

for (const c of [hostClient, guestClient]) c.ws.close();
await wait(300);

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\n✓ production smoke test passed");
