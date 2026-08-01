import type { ReactNode } from "react";
import { Bebas_Neue, Manrope } from "next/font/google";
import "./globals.css";
import { AudioProvider } from "../src/audio/AudioProvider";
import { SoundControl } from "../src/ui/SoundControl";

const display = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const body = Manrope({ subsets: ["latin"], variable: "--font-body" });

export const metadata = {
  title: "Games Dome — play together",
  description: "Thirteen party games in one room: Liar's Dice, Whot, Ludo, Trivia and more.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <div className="party-lights" aria-hidden="true" />
        {/* Audio wraps the whole app so the music carries across a move from
            the hub into a room, instead of restarting on every navigation. */}
        <AudioProvider>
          <SoundControl />
          {children}
        </AudioProvider>
      </body>
    </html>
  );
}
