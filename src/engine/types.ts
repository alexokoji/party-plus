export type Face = 1 | 2 | 3 | 4 | 5 | 6;

export interface Bid {
  quantity: number;
  face: Face;
}

export interface PlayerState {
  id: string;
  diceCount: number;
  dice: Face[]; // server-only; never sent to non-owning clients
  eliminated: boolean;
}

export type Phase = "bidding" | "gameOver";

export interface RoundResult {
  round: number;
  bid: Bid;
  bidderId: string;
  challengerId: string;
  actualCount: number;
  wildOnesCounted: boolean;
  bidderWon: boolean;
  loserId: string;
  allHands: Record<string, Face[]>;
}

export interface GameState {
  players: PlayerState[];
  currentPlayerIndex: number;
  currentBid: Bid | null;
  bidderIndex: number | null; // index of player who made currentBid
  round: number;
  palifico: boolean; // true if this round has a player at exactly 1 die -> ones not wild
  phase: Phase;
  winnerId: string | null;
  history: RoundResult[];
  rngSeed: number;
}

export type Action =
  | { type: "bid"; playerId: string; bid: Bid }
  | { type: "challenge"; playerId: string };

export const STARTING_DICE = 5;
export const DICE_FACES: Face[] = [1, 2, 3, 4, 5, 6];
