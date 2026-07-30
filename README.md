# Party Plus

A multiplayer party-game platform. The room engine is game-agnostic and every
game is a plug-in module.

**13 games:** Liar's Dice · Nigerian Whot · Ludo · Texas Hold'em (play-money
chips only) · Crazy 8s · Snakes & Ladders · Draughts · Chess · Dominoes ·
Werewolf · Code Words · Sketch & Guess · Trivia

## The idea

A room owns *people* — membership, join-by-code, ready-up, seating, the turn
clock, reconnection grace, spectators, chat and emotes — and knows no rules for
any game. Everything rules-shaped is delegated to a `GameModule`:

```ts
interface GameModule<TState, TMove, TView> {
  meta: GameMeta;
  createInitialState(players: string[], options?: GameOptions): TState;
  validateMove(state: TState, playerId: string, move: TMove): boolean;
  applyMove(state: TState, playerId: string, move: TMove): ApplyResult<TState>;
  getPlayerView(state: TState, playerId: string | null): TView;
  checkWinCondition(state: TState): WinCondition | null;
  getCurrentPlayerId(state: TState): string | null;
  // …optional: timed phases, turn forfeits, live stream channels, lobby options
}
```

Adding a game means writing a module and registering it. `RoomDO.ts` does not
change.

## Hidden information

The single rule the whole platform rests on: **`getPlayerView` is the only path
by which game state reaches a client.** The authoritative state is never
serialised to anyone. Views are built by allow-list rather than by copying the
state and deleting the secrets, because the second approach leaks the moment
someone adds a field.

Each game hides something different, and the same chokepoint handles all of it:

- **Liar's Dice** — your dice, never anyone else's
- **Whot / Crazy 8s / Dominoes** — your hand; opponents are a count
- **Hold'em** — hole cards, until a showdown
- **Werewolf** — roles, from everyone *including the dead*, until the game ends
- **Code Words** — the key, from everyone except the two spymasters
- **Sketch & Guess** — the word, from everyone except the drawer
- **Trivia** — the answer, from everyone, until the question closes

Clients send `{type: 'bid'}`-shaped intents carrying no random values. Dice are
rolled, cards dealt and guesses checked on the server.

## Stack

- **Next.js 15** (App Router) + React 19 on the client
- **Cloudflare Workers + Durable Objects** — one DO per room, WebSocket
  hibernation, alarms for turn and phase clocks
- **React Three Fiber** for the 3D dice, behind a swappable interface with a 2D
  fallback

## Content packs

Word and question banks live in `src/content` as data, not code, and load from
a KV namespace or an HTTP endpoint at match start — so questions can be added
or moderated without a redeploy. Everything entering the store is validated
first. Ships with Nigerian and Pidgin word packs, a Naija sketch pack, and a
Naija & Africa trivia pack alongside the general sets.

## Running it

Two servers: the web app and the room Worker.

```bash
npm install
npm run dev:all
```

Then open http://localhost:3000.

For several players on one machine, use different origins —
`localhost`, `127.0.0.1`, `a.localhost` — since player identity lives in
per-origin `localStorage`.

## Tests

```bash
npm test
```

727 unit tests. The rules engines were built and proven before any UI existed.

Live integration tests run against a real `wrangler dev` and assert what
actually goes out on the wire — that no hidden dice, hand, role, key, word or
answer reaches anyone not entitled to it:

```bash
npm run dev:room          # terminal 1
npm run test:do           # terminal 2
npm run test:new-games
npm run test:party-games
```

## Deploying

See [DEPLOY.md](DEPLOY.md). The room Worker goes to Cloudflare; the web app to
Vercel.

## Identity, rooms and abuse

Hidden information is only as good as knowing who you are talking to. The
server issues every player a signed identity token — guests included, with no
signup wall — and a socket is opened with a short-lived, room-scoped ticket
rather than a player id the client asserts. Accounts are optional on top:
claim a username and your existing identity comes with you, so you keep the
seat you are already sitting in.

Room codes are minted server-side from a CSPRNG, and a room must be created
before it can be joined, so a wrong guess is a 404 rather than a new empty
room. Rate limits sit on both the per-IP endpoints and each open socket.

## Not built

No email, so no password reset. No matchmaking, no ELO, no history recorded
against accounts. Moderation is per-room: the host can lock the room and
remove people.
