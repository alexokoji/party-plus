/**
 * Shared test client for the live integration scripts.
 *
 * Connecting used to be one line: open a socket and assert a player id. It is
 * not any more, and that is the point — the server issues the identity, and a
 * socket needs a signed, room-scoped ticket. These helpers walk that path so
 * each script does not have to.
 */
import WebSocket from "ws";

const PORT = process.env.ROOM_PORT ?? "8787";
export const HTTP = `http://127.0.0.1:${PORT}`;
export const WS = `ws://127.0.0.1:${PORT}`;

/**
 * A per-run caller address.
 *
 * Rate limits are keyed by `CF-Connecting-IP`. Locally there is no Cloudflare
 * edge to set it, so every caller shares one bucket and a second test run in
 * the same hour gets refused — the limiter working correctly, but making the
 * suite unrunnable. A fresh key per run gives each run its own buckets while
 * still exercising real limiting within a run.
 *
 * This is not a hole in production: Cloudflare sets CF-Connecting-IP at the
 * edge and overwrites whatever the client sent.
 */
export const RUN_IP = `test-${Math.random().toString(36).slice(2)}-${process.pid}`;

export async function post(path, body, token) {
  const response = await fetch(`${HTTP}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": RUN_IP,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

/** A signed guest identity, which is what everyone gets by default. */
export async function guest(name) {
  const { data, ok, status } = await post("/auth/guest", { name });
  if (!ok) throw new Error(`guest identity failed (${status}): ${data.error}`);
  return { token: data.token, id: data.user.id, name: data.user.name };
}

/** Mints a room. Codes come from the server now, not the client. */
export async function createRoom(token) {
  const { data, ok, status } = await post("/rooms", {}, token);
  if (!ok) throw new Error(`room creation failed (${status}): ${data.error}`);
  return data.code;
}

/**
 * Opens an authenticated socket.
 *
 * `onSnapshot` runs for every snapshot, which is where the leak assertions
 * live; `onStream` gets ephemeral frames.
 */
export async function connect(identity, code, { onSnapshot, onStream } = {}) {
  const ticketResponse = await post(`/rooms/${code}/ticket`, { name: identity.name }, identity.token);
  if (!ticketResponse.ok) {
    throw new Error(`ticket refused (${ticketResponse.status}): ${ticketResponse.data.error}`);
  }

  const ws = new WebSocket(`${WS}/room/${code}?ticket=${encodeURIComponent(ticketResponse.data.ticket)}`);
  const client = {
    id: identity.id,
    name: identity.name,
    token: identity.token,
    ws,
    snapshot: null,
    errors: [],
    events: [],
    streams: [],
    messages: 0,
    closed: null,
  };

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    client.messages++;
    if (msg.type === "error") return client.errors.push(msg.message);
    if (msg.type === "stream") {
      client.streams.push(msg);
      onStream?.(msg, client);
      return;
    }
    client.snapshot = msg.snapshot;
    for (const e of msg.snapshot.events ?? []) client.events.push(e);
    onSnapshot?.(msg.snapshot, client);
  });
  ws.on("close", (code, reason) => {
    client.closed = { code, reason: reason.toString() };
  });

  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  // Resolve on the first snapshot rather than on "open": callers immediately
  // assert against client.snapshot, and an open socket has not been told
  // anything yet.
  for (let i = 0; i < 100 && !client.snapshot; i++) await wait(20);
  return client;
}

/** A fresh guest joined to an existing room, which is the common case. */
export async function joinAs(name, code, handlers) {
  return connect(await guest(name), code, handlers);
}

export const send = (c, msg) => c.ws.send(JSON.stringify(msg));
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeWaiters(failures) {
  return {
    async waitFor(predicate, label, timeoutMs = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (predicate()) return true;
        await wait(50);
      }
      failures.push(`TIMEOUT waiting for ${label}`);
      return false;
    },
    async poll(predicate, timeoutMs = 6000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (predicate()) return true;
        await wait(50);
      }
      return false;
    },
  };
}

/** Seats a set of players in a fresh room and starts a match. */
export async function seatMatch({ names, gameId, options, handlers, failures, waitFor }) {
  const host = await guest(names[0]);
  const code = await createRoom(host.token);
  const clients = [await connect(host, code, handlers)];
  for (const name of names.slice(1)) clients.push(await joinAs(name, code, handlers));
  await wait(400);

  const [first] = clients;
  send(first, { type: "selectGame", gameId });
  await waitFor(() => first.snapshot?.gameId === gameId, `${gameId} selection`);

  if (options) {
    send(first, { type: "setGameOptions", options });
    await waitFor(
      () => Object.entries(options).every(([k, v]) => first.snapshot?.gameOptions?.[k] === v),
      `${gameId} options`
    );
  }
  for (const c of clients) send(c, { type: "ready", ready: true });
  await waitFor(() => first.snapshot?.members.filter((m) => m.seated).every((m) => m.ready), `${gameId} ready`);
  send(first, { type: "start" });
  await waitFor(() => first.snapshot?.phase === "playing", `${gameId} start`);
  return { clients, code };
}
