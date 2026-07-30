import { registerGame } from "../platform/registry";
import { liarsDiceModule } from "./liars-dice/module";
import { whotModule } from "./whot/module";
import { ludoModule } from "./ludo/module";
import { holdemModule } from "./holdem/module";
import { crazy8sModule } from "./crazy8s/module";
import { snakesModule } from "./snakes/module";
import { draughtsModule } from "./draughts/module";
import { chessModule } from "./chess/module";
import { dominoesModule } from "./dominoes/module";
import { werewolfModule } from "./werewolf/module";
import { codewordsModule } from "./codewords/module";
import { sketchModule } from "./sketch/module";
import { triviaModule } from "./trivia/module";

/**
 * Single import site for every built-in game.
 *
 * Importing this module has the side effect of registering games, so both the
 * Worker and the web app must import it exactly once before touching the
 * registry. Registration is guarded against duplicates, so a double import
 * throws loudly rather than silently shadowing a game.
 */
let registered = false;

export function registerBuiltInGames(): void {
  if (registered) return;
  registered = true;
  registerGame(liarsDiceModule);
  registerGame(whotModule);
  registerGame(ludoModule);
  registerGame(holdemModule);
  registerGame(crazy8sModule);
  registerGame(snakesModule);
  registerGame(draughtsModule);
  registerGame(chessModule);
  registerGame(dominoesModule);
  registerGame(werewolfModule);
  registerGame(codewordsModule);
  registerGame(sketchModule);
  registerGame(triviaModule);
}

registerBuiltInGames();

export {
  liarsDiceModule,
  whotModule,
  ludoModule,
  holdemModule,
  crazy8sModule,
  snakesModule,
  draughtsModule,
  chessModule,
  dominoesModule,
  werewolfModule,
  codewordsModule,
  sketchModule,
  triviaModule,
};
