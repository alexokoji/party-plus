import Link from "next/link";
import { LibraryView } from "../../src/ui/LibraryView";

export const metadata = {
  title: "Your library — Games Dome",
  description: "Everything you own, and everything you could.",
};

export default function LibraryPage() {
  return (
    <main>
      <div className="room-head">
        <h1>Library</h1>
        <Link href="/">← All games</Link>
      </div>
      <LibraryView />
    </main>
  );
}
