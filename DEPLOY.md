# Deploying Party Plus

Two pieces, deployed separately:

| Piece | Where | What it is |
| --- | --- | --- |
| **Room server** | Cloudflare Workers + Durable Objects | One DO per room. Owns all game state and every hidden-information decision. |
| **Web app** | Vercel | Next.js 15 App Router. Holds no authority — it renders whatever redacted view the server sends. |

The web app talks to the room server over a WebSocket, so the room server must
be deployed **first**: its URL is a build-time variable for the web app.

Both steps need an interactive browser login, so run them yourself.

---

## 1. Room server → Cloudflare

```bash
npx wrangler login
```

A free Cloudflare account is enough. The rooms are configured as
**SQLite-backed Durable Objects** (`new_sqlite_classes` in `wrangler.toml`),
which run on the free Workers plan — the older key-value backend requires the
$5/month Workers Paid plan.

Then deploy:

```bash
npm run deploy:room
```

Wrangler prints the URL, of the form
`https://party-plus-room.<your-subdomain>.workers.dev`. Check it:

```bash
curl https://party-plus-room.<your-subdomain>.workers.dev/health
```

Expect `{"ok":true,"service":"party-plus-room"}`.

## 2. Web app → Vercel

Set the room server URL first — note the **`wss://`** scheme, not `https://`:

```bash
npx vercel env add NEXT_PUBLIC_ROOM_WS_URL production
```

Paste `wss://party-plus-room.<your-subdomain>.workers.dev` when prompted, with
no trailing slash and no `/room` path. Repeat for the `preview` environment if
you want preview deploys to work.

Then deploy:

```bash
npx vercel --prod
```

The first run asks a few setup questions (scope, link to an existing project,
directory — accept the defaults). Vercel detects Next.js on its own; no
`vercel.json` is needed.

> `NEXT_PUBLIC_*` variables are baked in **at build time**. Changing it later
> means redeploying the web app, not just editing the variable.

## 3. Lock the room server to your web app

Until this is set, any website can point a client at your Worker and run their
traffic through your account. WebSocket upgrades get no CORS protection, so
this check is the only thing preventing it.

Edit `ALLOWED_ORIGINS` in `wrangler.toml` to your Vercel origin:

```toml
[vars]
ALLOWED_ORIGINS = "https://your-app.vercel.app"
```

Multiple origins are comma-separated, which is how you keep preview deploys
working:

```toml
ALLOWED_ORIGINS = "https://your-app.vercel.app,https://your-app-git-main-you.vercel.app"
```

Redeploy the Worker:

```bash
npm run deploy:room
```

Requests with no `Origin` header — the integration scripts — are still allowed;
the check is aimed at browsers.

---

## Verifying a deploy

Open the deployed site in two different browsers (or a normal and a private
window — player identity lives in per-origin `localStorage`, so two tabs of the
same browser share one identity), create a room in one, join by code in the
other, and start a match.

If it hangs on "Connecting…", check in this order:

1. `NEXT_PUBLIC_ROOM_WS_URL` is set in Vercel **and** the app was rebuilt after
   setting it.
2. The scheme is `wss://`, not `https://` or `ws://`.
3. `ALLOWED_ORIGINS` includes the exact origin in the browser's address bar —
   a preview deploy has a different hostname from production.
4. The browser console: a misconfigured URL throws a named error rather than
   failing silently.

## Updating content without redeploying

Word and question packs load from a data store at match-start, at most once a
minute. Neither source is required — the bundled packs work alone.

**HTTP** — serve a JSON array of packs and set in `wrangler.toml`:

```toml
[vars]
CONTENT_URL = "https://example.com/party-plus-packs.json"
```

**KV** — create a namespace, add the binding to `wrangler.toml`, then write
either a single `packs` key holding the whole array, or a `packs:index` key
listing ids with each pack under `pack:<id>`:

```bash
npx wrangler kv namespace create CONTENT
npx wrangler kv key put --binding=CONTENT packs "$(cat my-packs.json)" --remote
```

Packs are validated on arrival: a malformed pack is rejected and logged, the
rest of the batch still loads, and the bundled packs remain as a floor. A pack
registered under an existing id replaces it — that is how a correction lands.

## Costs

Free tiers cover a small deployment: Workers gives 100k requests/day, and a
WebSocket connection counts as one request rather than one per message.
Durable Object usage is billed on requests and duration; sustained traffic
eventually needs the $5/month Workers Paid plan. Vercel's hobby tier covers the
web app but is not licensed for commercial use.

## Things this deployment does not have

- **No accounts, no persistence between rooms.** Player identity is a random id
  in `localStorage`. Clearing site data means a new identity. Postgres for
  accounts/ELO/history and Redis for matchmaking were scoped but never built.
- **No rate limiting** beyond Cloudflare's defaults.
- **Room codes are guessable.** Anyone with a code can join; there are no
  private rooms.
- **A room's Durable Object lives until it is evicted.** There is no explicit
  cleanup of finished rooms.
