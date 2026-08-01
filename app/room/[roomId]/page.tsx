"use client";

import { use } from "react";
import Link from "next/link";
import { SoloLiarsDice } from "../../../src/ui/solo/SoloLiarsDice";

/**
 * The original practice URL.
 *
 * Kept so links people already have still work; the game itself now lives in a
 * shared component with /play/liars-dice rather than being duplicated.
 */
export default function PracticeRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  return (
    <main>
      <div className="room-head">
        <h1>Practice · {roomId}</h1>
        <Link href="/">← All games</Link>
      </div>
      <SoloLiarsDice />
    </main>
  );
}
