/**
 * A second player, for checking the UI by hand.
 *
 *   node scripts/partner.mjs <ROOMCODE> [gameId]
 *
 * Joins a room, readies up, starts the match once the browser player is ready,
 * and then plays a plain legal move whenever it is its turn — so whoever is
 * looking at the browser can watch what the other side's moves look like.
 */
import { connect, guest, send, wait } from "./roomClient.mjs";

const code = (process.argv[2] ?? "").toUpperCase();
const gameId = process.argv[3] ?? null;
if (!code) {
  console.error("usage: node scripts/partner.mjs <ROOMCODE> [gameId]");
  process.exit(1);
}

const me = await guest("Partner");
const client = await connect(me, code);
await wait(500);
console.log(`joined ${code} as ${me.id.slice(0, 10)}…`);

if (gameId) {
  send(client, { type: "selectGame", gameId });
  await wait(400);
}
send(client, { type: "ready", ready: true });
await wait(400);

/** A legal move for whichever game is running, chosen without any cleverness. */
function pick(snapshot) {
  const v = snapshot.view;
  if (!v) return null;
  switch (snapshot.gameId) {
    case "ludo":
      if (v.mustRoll) return { type: "roll" };
      return v.movablePawns?.length ? { type: "movePawn", pawn: v.movablePawns[0] } : null;
    case "snakes":
      return { type: "roll" };
    case "liars-dice":
      return v.currentBid
        ? { type: "bid", bid: { quantity: v.currentBid.quantity + 1, face: v.currentBid.face } }
        : { type: "bid", bid: { quantity: 1, face: 2 } };
    case "whot":
    case "crazy8s": {
      const playable = v.playableCardIds?.[0];
      if (!playable) return { type: "draw" };
      const card = (v.myHand ?? []).find((c) => (c.id ?? `${c.rank}${c.suit}`) === playable);
      return card?.shape === "whot" || card?.rank === 8
        ? { type: "play", cardId: playable, requestShape: "circle", declareSuit: "h" }
        : { type: "play", cardId: playable };
    }
    case "chess":
      return v.legalMoves?.length ? { type: "move", san: v.legalMoves[0] } : null;
    case "draughts":
      return v.legalMoves?.length ? v.legalMoves[0] : null;
    default:
      return null;
  }
}

let lastActed = "";
setInterval(() => {
  const snapshot = client.snapshot;
  if (!snapshot || snapshot.phase !== "playing") return;
  if (snapshot.currentPlayerId !== me.id) return;

  const fingerprint = JSON.stringify(snapshot.view).slice(0, 200);
  if (fingerprint === lastActed) return;
  lastActed = fingerprint;

  const move = pick(snapshot);
  if (move) {
    send(client, { type: "move", move });
    console.log(`played ${JSON.stringify(move)}`);
  }
}, 900);

// Start the match once the other seat is ready.
setInterval(() => {
  const snapshot = client.snapshot;
  if (!snapshot || snapshot.phase !== "lobby") return;
  const seated = snapshot.members.filter((m) => m.seated);
  if (seated.length >= 2 && seated.every((m) => m.ready) && snapshot.hostId === me.id) {
    send(client, { type: "start" });
  }
}, 1500);

console.log("waiting — ready up in the browser and I will play the other side");
