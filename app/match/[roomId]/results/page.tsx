import { buildPostMatchReport } from "../../../../src/engine/bluffScore";
import { BluffScorePanel } from "../../../../src/ui/BluffScorePanel";
import { playDemoMatch } from "../../../../lib/demoMatch";

function seedFromRoomId(roomId: string): number {
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) {
    hash = (hash * 31 + roomId.charCodeAt(i)) | 0;
  }
  return hash || 1;
}

export default async function ResultsPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  // TODO: once rooms persist finished GameState (RoomDO storage), fetch the
  // real state for `roomId` here instead of simulating a demo match.
  const state = playDemoMatch(seedFromRoomId(roomId));
  const report = buildPostMatchReport(state);

  return (
    <main>
      <h1>Match results</h1>
      <p>
        Room <strong style={{ color: "var(--text)" }}>{roomId}</strong> · Winner:{" "}
        <strong style={{ color: "var(--gold)" }}>{report.winnerId}</strong> 🏆
      </p>
      <div className="card-panel">
        <BluffScorePanel report={report} />
      </div>
    </main>
  );
}
