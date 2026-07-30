import type { ReactNode } from "react";
import { Bebas_Neue, Manrope } from "next/font/google";
import "./globals.css";

const display = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const body = Manrope({ subsets: ["latin"], variable: "--font-body" });

export const metadata = {
  title: "Party Plus — Liar's Dice",
  description: "Web-based Perudo — house party energy, casino stakes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <div className="party-lights" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
