/**
 * End-to-end check of Code Words, Sketch & Guess and Trivia through the real
 * room Durable Object.
 *
 *   npm run dev:room             (terminal 1)
 *   npm run test:party-games     (terminal 2)
 *
 * These three hide different things — a key, a word, an answer — and the
 * drawing game adds a live relay channel that bypasses game state entirely.
 * Only a real socket proves what actually goes out on the wire.
 */
import { connect, createRoom, guest, joinAs, makeWaiters, send, wait } from "./roomClient.mjs";

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const { waitFor } = makeWaiters(failures);

/**
 * Watches every snapshot for leaks.
 *
 * Passed to the shared client, which runs it on each snapshot for each player,
 * so a leak anywhere in a whole match is caught rather than only at the
 * moments the script happens to look.
 */
function leakWatch(snapshot, client) {
  const id = client.id;
  if (snapshot.gameState !== undefined) failures.push(`LEAK: raw gameState sent to ${id}`);

  const view = snapshot.view;
  if (!view) return;
  const wire = JSON.stringify(view);

  // ---- Dominoes-style hidden hands.
  if (snapshot.gameId === "dominoes" && snapshot.youArePlaying && !view.seesAllHands) {
    for (const opp of view.opponents ?? []) {
      const keys = Object.keys(opp).sort().join(",");
      if (keys !== "id,tileCount") failures.push(`LEAK: dominoes opponent payload for ${id}: ${keys}`);
    }
  }

  // ---- Code Words: only a spymaster may see card owners.
  if (snapshot.gameId === "codewords" && !view.seesKey && !view.finished) {
    for (const card of view.cards ?? []) {
      if (!card.revealed && card.owner !== null) {
        failures.push(`LEAK: ${id} was given the owner of a face-down card`);
      }
    }
    if (wire.includes("assassin")) failures.push(`LEAK: the assassin reached ${id}`);
  }

  // ---- Trivia: the key appears only once a question has closed.
  if (snapshot.gameId === "trivia" && view.phase === "question") {
    if (view.reveal !== null) failures.push(`LEAK: ${id} got the reveal mid-question`);
    if (wire.includes("answerIndex")) failures.push(`LEAK: answerIndex reached ${id}`);
  }
}

/** Seats players in a fresh, server-minted room and starts a match. */
async function seat(names, gameId, options) {
  const host = await guest(names[0]);
  const code = await createRoom(host.token);
  const clients = [await connect(host, code, { onSnapshot: leakWatch })];
  for (const name of names.slice(1)) {
    clients.push(await joinAs(name, code, { onSnapshot: leakWatch }));
  }
  await wait(400);

  const [first] = clients;
  send(first, { type: "selectGame", gameId });
  await waitFor(() => first.snapshot?.gameId === gameId, `${gameId} selection`);

  const groups = first.snapshot?.optionGroups ?? [];
  check(groups.some((g) => g.key === "pack"), `${gameId} advertised no content packs to the lobby`);
  check((groups.find((g) => g.key === "pack")?.options ?? []).length >= 2, `${gameId} offered fewer than two packs`);

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

// ================= Code Words =================
const { clients: cw, code: CROOM } = await seat(["cw1", "cw2", "cw3", "cw4"], "codewords", { pack: "words-naija" });
const [c1] = cw;
console.log(`code words: 4 players seated in ${CROOM}`);

const cwView = (c) => c.snapshot.view;
check(cwView(c1).cards.length === 25, `expected a 25-card grid, got ${cwView(c1).cards.length}`);
check(cwView(c1).packId === "words-naija", `pack not applied: ${cwView(c1).packId}`);

const spymasters = cw.filter((c) => cwView(c).me?.role === "spymaster");
const operatives = cw.filter((c) => cwView(c).me?.role === "operative");
check(spymasters.length === 2, `expected 2 spymasters, got ${spymasters.length}`);
check(operatives.length === 2, `expected 2 operatives, got ${operatives.length}`);

// THE invariant: only a spymaster's payload carries the key.
for (const c of operatives) {
  const view = cwView(c);
  check(view.seesKey === false, `LEAK: operative ${c.id} was told they see the key`);
  check(
    view.cards.every((card) => card.owner === null),
    `LEAK: operative ${c.id} received card owners`
  );
  check(!JSON.stringify(view).includes("assassin"), `LEAK: the assassin reached operative ${c.id}`);
}
for (const c of spymasters) {
  check(cwView(c).cards.every((card) => card.owner !== null), `spymaster ${c.id} cannot see the key`);
}

// An operative cannot clue, and a spymaster cannot guess.
const turn = cwView(c1).turn;
const mySpy = spymasters.find((c) => cwView(c).me.team === turn);
const myOp = operatives.find((c) => cwView(c).me.team === turn);
const theirSpy = spymasters.find((c) => cwView(c).me.team !== turn);

myOp.errors.length = 0;
send(myOp, { type: "move", move: { type: "clue", word: "shortcut", count: 2 } });
await wait(250);
check(myOp.errors.some((e) => /illegal/i.test(e)), "an operative was allowed to give the clue");

theirSpy.errors.length = 0;
send(theirSpy, { type: "move", move: { type: "clue", word: "offturn", count: 1 } });
await wait(250);
check(theirSpy.errors.some((e) => /illegal/i.test(e)), "the other team's spymaster could clue out of turn");

// A clue naming a word on the table must be refused by the server.
mySpy.errors.length = 0;
send(mySpy, { type: "move", move: { type: "clue", word: cwView(c1).cards[0].word, count: 1 } });
await wait(250);
check(mySpy.errors.some((e) => /illegal/i.test(e)), "a clue naming a board word was accepted");

// Multi-word clues too.
mySpy.errors.length = 0;
send(mySpy, { type: "move", move: { type: "clue", word: "two words", count: 1 } });
await wait(250);
check(mySpy.errors.some((e) => /illegal/i.test(e)), "a two-word clue was accepted");

send(mySpy, { type: "move", move: { type: "clue", word: "signal", count: 2 } });
await waitFor(() => cwView(c1).phase === "guess", "the clue to open guessing");
check(cwView(c1).clue?.word === "signal", "the clue did not reach the table");
check(cwView(myOp).guessesLeft === 3, `expected 3 guesses, got ${cwView(myOp).guessesLeft}`);

// The spymaster knows which card is safe; the operative taps it.
const spyCards = cwView(mySpy).cards;
const ownIndex = spyCards.findIndex((c) => c.owner === turn && !c.revealed);
send(myOp, { type: "move", move: { type: "guess", cardIndex: ownIndex } });
await waitFor(() => cwView(c1).cards[ownIndex].revealed, "the card to flip");
check(cwView(myOp).cards[ownIndex].owner === turn, "a revealed card kept its owner hidden from the guesser");
check(
  cwView(myOp).cards.filter((c) => c.owner !== null).length === 1,
  "revealing one card exposed more than one owner to the operative"
);
console.log(`code words: clue given, ${turn} card revealed, key still hidden from operatives`);

for (const c of cw) c.ws.close();
await wait(200);

// ================= Trivia =================
const { clients: tv, code: TROOM } = await seat(["tv1", "tv2", "tv3"], "trivia", { pack: "trivia-naija", variant: "blitz" });
const [t1, t2, t3] = tv;
console.log(`trivia: 3 players seated in ${TROOM}`);

const tvView = (c) => c.snapshot.view;
check(tvView(t1).packId === "trivia-naija", `trivia pack not applied: ${tvView(t1).packId}`);
check(tvView(t1).question?.options.length >= 2, "no options reached the players");
check(tvView(t1).reveal === null, "LEAK: the answer key was sent with an open question");
for (const c of tv) {
  check(!JSON.stringify(tvView(c)).includes("answerIndex"), `LEAK: answerIndex reached ${c.id}`);
}

// Answer with every option: exactly one of the three must be right, and the
// server decides which — the clients were never told.
const optionCount = tvView(t1).question.options.length;
tv.forEach((c, i) => send(c, { type: "move", move: { type: "answer", optionIndex: i % optionCount } }));
await waitFor(() => tvView(t1).phase === "reveal", "the question to close once everyone answered");

const reveal = tvView(t1).reveal;
check(reveal !== null, "no reveal after the question closed");
check(typeof reveal?.correctIndex === "number", "the reveal carried no correct answer");
const scored = tvView(t1).leaderboard.filter((r) => r.score > 0);
check(scored.length === 1, `expected exactly one scorer, got ${scored.length}`);
check(
  tvView(t1).leaderboard.filter((r) => r.lastAnswerCorrect === true).length === 1,
  "more than one answer was marked correct"
);

// A second answer from the same player must be refused.
t1.errors.length = 0;
send(t1, { type: "move", move: { type: "answer", optionIndex: 0 } });
await wait(250);
check(t1.errors.some((e) => /illegal/i.test(e)), "a second answer was accepted");

// The clock moves the match on by itself.
await waitFor(() => tvView(t1).questionNumber === 2, "the reveal clock to bring the next question", 15000);
check(tvView(t1).reveal === null, "LEAK: the reveal survived into the next question");
console.log(`trivia: question 1 scored, question 2 arrived on the clock`);

for (const c of tv) c.ws.close();
await wait(200);

// ================= Sketch & Guess =================
const { clients: sk, code: SROOM } = await seat(["sk1", "sk2", "sk3"], "sketch", { pack: "draw-naija", variant: "quick" });
const [s1] = sk;
console.log(`sketch: 3 players seated in ${SROOM}`);

const skView = (c) => c.snapshot.view;
const drawerId = skView(s1).drawerId;
const drawer = sk.find((c) => c.id === drawerId);
const guessers = sk.filter((c) => c.id !== drawerId);

check(skView(drawer).choices?.length >= 2, "the drawer was offered no words");
for (const c of guessers) {
  check(skView(c).choices === null, `LEAK: ${c.id} received the drawer's shortlist`);
  check(skView(c).word === null, `LEAK: ${c.id} received the word`);
}

// A guesser cannot choose the word.
guessers[0].errors.length = 0;
send(guessers[0], { type: "move", move: { type: "chooseWord", index: 0 } });
await wait(250);
check(guessers[0].errors.some((e) => /illegal/i.test(e)), "a guesser chose the word");

send(drawer, { type: "move", move: { type: "chooseWord", index: 0 } });
await waitFor(() => skView(s1).phase === "drawing", "drawing to start");

const word = skView(drawer).word;
check(typeof word === "string" && word.length > 0, "the drawer was not told their own word");
for (const c of guessers) {
  const wire = JSON.stringify(skView(c));
  check(!wire.includes(word), `LEAK: the word "${word}" reached ${c.id}`);
  check(typeof skView(c).wordMask === "string", `${c.id} got no mask to guess against`);
  check(skView(c).wordMask.includes("_"), `${c.id}'s mask was not masked`);
}

// ---- the live drawing channel ----
for (const c of sk) c.streams.length = 0;
send(drawer, { type: "stream", channel: "draw", data: { k: "s", x: 0.5, y: 0.5, c: "#000", w: 6 } });
send(drawer, { type: "stream", channel: "draw", data: { k: "m", x: 0.6, y: 0.55 } });
await waitFor(
  () => guessers.every((c) => c.streams.length >= 2),
  "stroke frames to reach the other players"
);
check(
  guessers.every((c) => c.streams.every((f) => f.from === drawerId && f.channel === "draw")),
  "a relayed frame was mislabelled"
);
check(drawer.streams.length === 0, "the drawer was echoed their own strokes");

// Frames must not become game state or chat.
const beforeEvents = s1.snapshot.events.length;
await wait(300);
check(s1.snapshot.events.length === beforeEvents, "stream frames leaked into the event feed");

// A guesser must not be able to scribble.
for (const c of sk) c.streams.length = 0;
send(guessers[0], { type: "stream", channel: "draw", data: { k: "s", x: 0.1, y: 0.1, c: "#f00", w: 4 } });
await wait(400);
check(
  sk.every((c) => c.streams.length === 0),
  "a guesser's strokes were relayed — anyone could draw over the canvas"
);

// And no other channel is open, even to the drawer.
send(drawer, { type: "stream", channel: "whispers", data: { word } });
await wait(400);
check(sk.every((c) => c.streams.length === 0), "an unauthorised channel was relayed");

// ---- guessing ----
guessers[0].errors.length = 0;
send(guessers[0], { type: "move", move: { type: "guess", text: "definitely not the word" } });
await waitFor(() => skView(s1).guesses.length > 0, "a wrong guess to appear in the feed");
check(skView(s1).guesses[0].correct === false, "a wrong guess was marked correct");
check(skView(s1).guesses[0].text === "definitely not the word", "a wrong guess was hidden");

// The correct guess: checked on the server, against a word this client was
// never given. It arrives here only because the test cheats and reads the
// drawer's own view.
send(guessers[0], { type: "move", move: { type: "guess", text: word.toUpperCase() } });
await waitFor(() => skView(s1).solvedBy.includes(guessers[0].id), "the correct guess to register");
const solvedEntry = skView(s1).guesses.find((g) => g.correct);
check(solvedEntry.text === null, `LEAK: the correct guess published the word (${solvedEntry.text})`);
check(
  !JSON.stringify(skView(guessers[1])).includes(word),
  "LEAK: solving it published the word to the player still guessing"
);
check(skView(guessers[0]).iSolved === true, "the solver was not told they solved it");
const solverScore = skView(s1).scores.find((r) => r.playerId === guessers[0].id).score;
check(solverScore > 0, "a correct guess scored nothing");

// The drawer cannot guess their own word.
drawer.errors.length = 0;
send(drawer, { type: "move", move: { type: "guess", text: word } });
await wait(250);
check(drawer.errors.some((e) => /illegal/i.test(e)), "the drawer guessed their own word");

console.log(`sketch: strokes relayed, "${word}" guessed server-side, word never sent to guessers`);

for (const c of sk) c.ws.close();
await wait(300);

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\n✓ Code Words + Trivia + Sketch & Guess through the live room DO: all checks passed");
console.log("  (no key, no word and no answer reached anyone not entitled to it;");
console.log("   the drawing channel relays only the drawer, only while drawing)");
