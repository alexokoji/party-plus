/**
 * Where the room Worker lives.
 *
 * Falls back to the local `wrangler dev` address only when the page itself is
 * on localhost. A deployed build with no NEXT_PUBLIC_ROOM_WS_URL used to
 * silently dial 127.0.0.1 and hang on "connecting" forever; failing loudly
 * turns that into an obvious misconfiguration.
 */
export function roomWsBase(): string {
  const configured = process.env.NEXT_PUBLIC_ROOM_WS_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost") || host === "") {
    return "ws://127.0.0.1:8787";
  }
  throw new Error(
    "NEXT_PUBLIC_ROOM_WS_URL is not set. Point it at the deployed room Worker, e.g. wss://party-plus-room.<subdomain>.workers.dev"
  );
}

/** The same Worker over HTTP, for the auth and room-creation endpoints. */
export function roomHttpBase(): string {
  return roomWsBase().replace(/^ws/, "http");
}

/** roomWsBase() throws when misconfigured; the UI still needs something to show. */
export function safeServerUrl(): string {
  try {
    return roomWsBase();
  } catch {
    return "NEXT_PUBLIC_ROOM_WS_URL (not set)";
  }
}
