# Carrying games other people made

Games Dome can host three kinds of game:

| Kind | Who wrote it | Where state lives | Example |
| --- | --- | --- | --- |
| **Room game** (`GameModule`) | us | a Durable Object | Whot, Werewolf, Trivia |
| **Solo game** (`SoloGame`) | us | the browser | Word Hunt, Danfo Dash |
| **External game** (`ExternalGame`) | a distributor | their servers | anything you licence |

This document is about the third. It is how a catalogue grows to hundreds of
titles without writing hundreds of games.

## How the money works

A distributor licences a library of HTML5 games to sites like yours and shares
the ad revenue earned inside the frame. You carry the game; they handle the
licensing, hosting and ads; the split is theirs to set.

**Read their terms yourself before relying on any number.** Splits, payout
thresholds, minimum traffic and ad behaviour differ between providers and
change over time — I have deliberately not written any figures here, because a
number in a repo outlives its accuracy.

The two providers the loader already trusts:

- **GameDistribution** — <https://gamedistribution.com> (publisher signup)
- **GamePix** — <https://www.gamepix.com/publishers>

Both are established HTML5 distributors. There are others; adding one means
adding its host to `ALLOWED_EMBED_HOSTS`.

## Adding a game

1. Open a publisher account with a distributor and accept their terms.
2. Find a game in their dashboard and copy its **embed URL**.
3. Add an entry to `EXTERNAL_GAMES` in [src/external/catalogue.ts](src/external/catalogue.ts):

```ts
{
  id: "some-runner",
  name: "Some Runner",
  tagline: "One sentence for the gallery card.",
  category: "arcade",          // party | board | card | puzzle | arcade
  provider: "gamedistribution",
  embedUrl: "https://html5.gamedistribution.com/<their-game-id>/",
  aspectRatio: 16 / 9,          // 9 / 16 for portrait games
  hasAds: true,
  estimatedMinutes: 5,
}
```

That is the whole job. It appears in the gallery, gets a `/play/<id>` page, and
is grouped by category with everything else.

## What the code refuses to do

Embedding runs a stranger's code in front of your users under your name, so the
loader fails closed:

- **Only allow-listed hosts.** A typo or a bad paste is rejected at load with a
  named error, not shipped. Adding a host is a deliberate edit to
  `ALLOWED_EMBED_HOSTS` in [src/external/types.ts](src/external/types.ts).
- **https only.** Over http, anyone on the network could rewrite the game on
  its way to the player.
- **No `javascript:` or `data:` URLs.**
- **A sandboxed frame.** The game may run scripts and store its own progress,
  but it cannot navigate your page away, open popups over it, or reach your
  origin — so it can never see a player's session token.
- **Nothing loads until the player presses play.** No third-party script, ad
  call or tracker runs because somebody glanced at the page. It also keeps the
  gallery fast.
- **Ads are declared before the click.** `hasAds: true` puts "contains ads" on
  the cover. Ads are why these games are free to carry; springing them on
  someone is how a site loses trust.

## On specific titles

Named games — *Level Devil* and its like — belong to their studios. Carry one
only if it appears in a distributor's catalogue, or licence it from the studio
directly. Cloning it is not an option worth the risk.

The alternative is building originals in the same genre, which is what
**Danfo Dash** is: ours, free of licensing, and no revenue share.
