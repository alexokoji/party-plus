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

The repo is at <https://github.com/alexokoji/party-plus>, so import it rather
than uploading from your machine — you get auto-deploy on push and a preview
URL per branch.

1. Go to <https://vercel.com/new> and sign in **with GitHub**.
2. Import `alexokoji/party-plus`. Vercel detects Next.js on its own — leave
   the framework, build command and output directory alone. No `vercel.json`
   is needed.
3. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_ROOM_WS_URL` | `wss://party-plus-room.<your-subdomain>.workers.dev` |

   Note the **`wss://`** scheme — not `https://`, not `ws://`. No trailing
   slash, no `/room` path. Tick Production **and** Preview.
4. Deploy.

Or from the CLI, if you prefer:

```bash
npx vercel env add NEXT_PUBLIC_ROOM_WS_URL production
```

```bash
npx vercel --prod
```

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

## Accounts and the signing secret

Identity is a token the server signs. Everyone gets one — guests included —
which is what stops one player connecting as another.

The signing secret is optional. Left unset, the auth object generates one on
first use and keeps it, so a fresh deploy works with no setup. The cost is that
wiping that object signs everybody out. To set it explicitly:

```bash
npx wrangler secret put AUTH_SECRET
```

Use a long random value. Changing it later invalidates every existing token,
which signs everyone out but breaks nothing else.

Accounts live in a single `AuthDO` instance. Passwords are stored as
PBKDF2-HMAC-SHA256 with a per-user salt and 150,000 iterations — never in plain
text, and never sent back to a client.

## Email (confirmation and password reset)

Workers cannot open an SMTP connection, so mail goes out over HTTP through a
provider. **Everything works without this configured** — links are printed to
the Worker log instead of sent, which is how the reset flow is testable
locally. In production, unset means nobody can recover an account.

Set two secrets and one variable:

```bash
npx wrangler secret put RESEND_API_KEY
```

```toml
[vars]
EMAIL_FROM = "Party Plus <no-reply@yourdomain.com>"
APP_URL = "https://your-app.vercel.app"
```

`APP_URL` is what the links in emails point at, so it must be the address
people can actually reach — getting this wrong sends everyone to a dead link.
`EMAIL_FROM` must be on a domain verified in your [Resend](https://resend.com)
account; their free tier covers 3,000 emails a month.

Then redeploy:

```bash
npm run deploy:room
```

To check it, register an account and watch the Worker log: `[email:log]` means
it is still unconfigured, and `[email:error]` reports what the provider said.

Using a different provider means one function — `sendEmail` in
[src/auth/email.ts](src/auth/email.ts) — and nothing else.

How the links behave:

- **Verification** lasts 24 hours; **reset** lasts one hour. Both work once.
- Only a SHA-256 hash of each link secret is stored, so a dump of the auth
  object does not hand over the ability to take over accounts.
- A completed reset bumps the account's password version, which **signs out
  every other session** — the point being that whoever prompted the reset
  loses their access too.
- Forgotten-password requests answer identically for known and unknown
  addresses, so the endpoint cannot be used to find out who has an account.

## Rate limits

Two layers, both on by default:

- **Per IP**, in `RateLimiterDO`, on the endpoints reachable from outside:
  guest identities, registration, login, room creation, and room tickets. The
  ticket limit is the one that matters most — it is the only way to discover
  whether a room code exists, so it is what anyone guessing codes runs into.
- **Per connection**, in memory inside each room, with separate budgets for
  chat, moves and drawing frames. A player flooding chat cannot starve the
  moves of the person next to them.

Both fail *open*: if the limiter itself is unavailable, requests proceed. A
rate limiter that takes the site down when it breaks is a worse outage than
the abuse it prevents.

## Things this deployment does not have

- **No moderation tools** beyond the host's lock and kick, which are per-room.
- **A room's Durable Object lives until it is evicted.** There is no explicit
  cleanup of finished rooms.
- **No ELO, history or matchmaking.** Accounts exist; nothing is recorded
  against them yet.
