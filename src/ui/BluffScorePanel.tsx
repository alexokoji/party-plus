import { BidVerdict, BluffScoreEntry, PlayerBluffSummary, PostMatchReport } from "../engine/bluffScore";

export interface BluffScorePanelProps {
  report: PostMatchReport;
  /** Maps a player id to a display name; falls back to the raw id. */
  playerNames?: Record<string, string>;
}

const VERDICT_LABEL: Record<BidVerdict, string> = {
  "bluff-succeeded": "Bluff paid off",
  "bluff-caught": "Bluff caught",
  "honest-bid": "Solid bid",
  "bad-beat": "Bad beat",
};

const VERDICT_CLASS: Record<BidVerdict, string> = {
  "bluff-succeeded": "verdict-bluff-succeeded",
  "bluff-caught": "verdict-bluff-caught",
  "honest-bid": "verdict-honest",
  "bad-beat": "verdict-bad-beat",
};

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function name(id: string, playerNames?: Record<string, string>): string {
  return playerNames?.[id] ?? id;
}

function RoundRow({ entry, playerNames }: { entry: BluffScoreEntry; playerNames?: Record<string, string> }) {
  return (
    <tr>
      <td>{entry.round}</td>
      <td>{name(entry.bidderId, playerNames)}</td>
      <td>{name(entry.challengerId, playerNames)}</td>
      <td>
        {entry.bid.quantity} × {entry.bid.face}
      </td>
      <td>{entry.actualCount}</td>
      <td title="Chance the bid was true, from the bidder's own seat (their hand known, rest unknown)">
        {pct(entry.probabilityBidderView)}
      </td>
      <td>
        <span className={VERDICT_CLASS[entry.verdict]}>{VERDICT_LABEL[entry.verdict]}</span>
      </td>
    </tr>
  );
}

function PlayerSummaryRow({
  summary,
  playerNames,
  isWinner,
}: {
  summary: PlayerBluffSummary;
  playerNames?: Record<string, string>;
  isWinner: boolean;
}) {
  return (
    <tr>
      <td>
        {name(summary.playerId, playerNames)}
        {isWinner ? " ★" : ""}
      </td>
      <td>{summary.bidsMade}</td>
      <td>{pct(summary.avgBluffSeverity)}</td>
      <td>{summary.bluffsSucceeded}</td>
      <td>{summary.bluffsCaught}</td>
      <td>
        {summary.challengesMade === 0
          ? "—"
          : `${summary.challengesCorrect}/${summary.challengesMade}`}
      </td>
    </tr>
  );
}

/**
 * Post-match summary: every bid that got challenged, scored against how
 * likely it was to be true from the bidder's own vantage point, plus a
 * per-player bluffing/calling profile. Pure presentational component —
 * takes the already-computed report as a prop, no data fetching.
 */
export function BluffScorePanel({ report, playerNames }: BluffScorePanelProps) {
  return (
    <div className="bluff-score-panel">
      <h2>Match Summary</h2>

      <table className="bluff-player-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Bids</th>
            <th>Avg. bluff</th>
            <th>Bluffs landed</th>
            <th>Bluffs caught</th>
            <th>Challenge record</th>
          </tr>
        </thead>
        <tbody>
          {report.players.map((summary) => (
            <PlayerSummaryRow
              key={summary.playerId}
              summary={summary}
              playerNames={playerNames}
              isWinner={summary.playerId === report.winnerId}
            />
          ))}
        </tbody>
      </table>

      <h3>Round by round</h3>
      <table className="bluff-round-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Bidder</th>
            <th>Challenger</th>
            <th>Bid</th>
            <th>Actual</th>
            <th>Bidder's odds</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {report.rounds.map((entry) => (
            <RoundRow key={entry.round} entry={entry} playerNames={playerNames} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
