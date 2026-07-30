/// <reference types="@cloudflare/workers-types" />
import { Env, RoomDO } from "./RoomDO";

export { RoomDO };

/**
 * Is this origin allowed to open a room socket?
 *
 * WebSocket upgrades are not subject to CORS, so without a check here any
 * website could point a client at this Worker and run their traffic through
 * someone else's account. An empty ALLOWED_ORIGINS means "allow any", which is
 * what local development and a private test want; production sets it to the
 * web app's origin.
 */
export function originAllowed(request: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (allowed.length === 0) return true;

  const origin = request.headers.get("Origin");
  // Non-browser clients — the integration scripts — send no Origin header.
  if (!origin) return true;
  return allowed.includes(origin.replace(/\/$/, ""));
}

/** Routes /room/:roomId to that room's Durable Object instance. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Cheap liveness probe: confirms the Worker is up without opening a
    // socket, which is the first thing worth checking after a deploy.
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "party-plus-room" }), {
        headers: { "content-type": "application/json" },
      });
    }

    const match = url.pathname.match(/^\/room\/([A-Za-z0-9_-]+)$/);
    if (!match) return new Response("not found", { status: 404 });
    if (!originAllowed(request, env)) return new Response("origin not allowed", { status: 403 });

    const roomId = match[1]!;
    const id = env.ROOM.idFromName(roomId);
    const stub = env.ROOM.get(id);
    return stub.fetch(request);
  },
};
