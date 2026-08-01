"use client";

/**
 * Cover art for the gallery.
 *
 * Inline SVG rather than images on purpose: the whole set costs a few
 * kilobytes inside the JS that was already being downloaded, versus thirteen
 * separate image requests. This project is meant to be cheap on a phone plan,
 * and a gallery of photographs would be the single biggest thing on the page.
 *
 * Each one is a flat, bold shape that reads at thumbnail size — the point is
 * to tell the games apart at a glance, not to be illustration.
 */

export interface GameArtProps {
  gameId: string;
  className?: string;
}

const FRAME = { viewBox: "0 0 160 100", preserveAspectRatio: "xMidYMid slice" } as const;

/** Distinct background per game, so even the colour is a cue. */
const BACKDROPS: Record<string, [string, string]> = {
  "liars-dice": ["#3b2f6b", "#241d47"],
  whot: ["#1f5d4c", "#123a30"],
  ludo: ["#5b3520", "#2f1c11"],
  holdem: ["#14532d", "#0b2f1a"],
  crazy8s: ["#4c1d5b", "#2c1036"],
  snakes: ["#1e4f6b", "#122f40"],
  draughts: ["#4a3520", "#241a10"],
  chess: ["#2f3640", "#1a1f25"],
  dominoes: ["#1f3a5f", "#122238"],
  werewolf: ["#3a1f1f", "#1f1010"],
  codewords: ["#1f3f5b", "#122636"],
  sketch: ["#5b4a1f", "#332a11"],
  trivia: ["#2c1f5b", "#191036"],
};

function Backdrop({ gameId }: { gameId: string }) {
  const [from, to] = BACKDROPS[gameId] ?? ["#2a2f3a", "#181b22"];
  const id = `bg-${gameId}`;
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill={`url(#${id})`} />
    </>
  );
}

const die = (x: number, y: number, pips: number[][], rotate = 0) => (
  <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
    <rect width="30" height="30" rx="6" fill="#f6f1e4" />
    {pips.map(([px, py], i) => (
      <circle key={i} cx={px} cy={py} r="3" fill="#241f1a" />
    ))}
  </g>
);

const card = (x: number, y: number, rotate: number, fill: string, mark?: React.ReactNode) => (
  <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
    <rect width="30" height="42" rx="4" fill={fill} stroke="#0d0f13" strokeWidth="1.5" />
    {mark}
  </g>
);

const ART: Record<string, React.ReactNode> = {
  "liars-dice": (
    <>
      {die(28, 34, [[15, 15]])}
      {die(64, 24, [
        [9, 9],
        [21, 21],
      ], -8)}
      {die(96, 40, [
        [9, 9],
        [15, 15],
        [21, 21],
      ], 10)}
    </>
  ),
  whot: (
    <>
      {card(30, 28, -12, "#f6f1e4", <circle cx="15" cy="21" r="8" fill="#1f5d4c" />)}
      {card(60, 24, 0, "#f6f1e4", <path d="M15 9 L23 27 H7 Z" fill="#d0553f" />)}
      {card(92, 28, 12, "#f6f1e4", <rect x="7" y="13" width="16" height="16" fill="#3f7fd0" />)}
    </>
  ),
  ludo: (
    <>
      <rect x="45" y="20" width="70" height="70" rx="6" fill="#f6f1e4" opacity="0.12" />
      <circle cx="58" cy="33" r="10" fill="#d0553f" />
      <circle cx="102" cy="33" r="10" fill="#3f7fd0" />
      <circle cx="58" cy="77" r="10" fill="#4ec98a" />
      <circle cx="102" cy="77" r="10" fill="#e8c85a" />
      <path d="M80 20 v70 M45 55 h70" stroke="#f6f1e4" strokeWidth="2" opacity="0.25" />
    </>
  ),
  holdem: (
    <>
      {card(34, 26, -10, "#f6f1e4", <text x="15" y="26" fontSize="16" textAnchor="middle" fill="#d0553f">A</text>)}
      {card(66, 22, 0, "#f6f1e4", <text x="15" y="26" fontSize="16" textAnchor="middle" fill="#1a1a1a">K</text>)}
      <circle cx="118" cy="62" r="13" fill="#e8c85a" stroke="#8a6d1f" strokeWidth="3" />
      <circle cx="112" cy="70" r="13" fill="#d0553f" stroke="#7a2f22" strokeWidth="3" />
    </>
  ),
  crazy8s: (
    <>
      {card(38, 26, -14, "#f6f1e4", <text x="15" y="28" fontSize="20" textAnchor="middle" fill="#8e44ad">8</text>)}
      {card(74, 26, 8, "#f6f1e4", <text x="15" y="28" fontSize="20" textAnchor="middle" fill="#d0553f">8</text>)}
    </>
  ),
  snakes: (
    <>
      <rect x="34" y="16" width="92" height="72" rx="4" fill="#f6f1e4" opacity="0.14" />
      <path
        d="M46 78 C 70 78, 66 50, 90 50 S 118 26, 118 26"
        stroke="#4ec98a"
        strokeWidth="7"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M56 26 L56 78 M70 26 L70 78" stroke="#e8c85a" strokeWidth="4" />
      <path d="M56 38 h14 M56 52 h14 M56 66 h14" stroke="#e8c85a" strokeWidth="3" />
    </>
  ),
  draughts: (
    <>
      <rect x="40" y="14" width="80" height="72" rx="4" fill="#f2ece0" opacity="0.18" />
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3].map((c) =>
          (r + c) % 2 === 0 ? (
            <rect key={`${r}${c}`} x={40 + c * 20} y={14 + r * 18} width="20" height="18" fill="#2a2320" opacity="0.5" />
          ) : null
        )
      )}
      <circle cx="70" cy="41" r="9" fill="#f2ece0" stroke="#b9ae99" strokeWidth="2" />
      <circle cx="100" cy="59" r="9" fill="#2a2320" stroke="#55483f" strokeWidth="2" />
    </>
  ),
  chess: (
    <>
      <rect x="40" y="14" width="80" height="72" rx="4" fill="#f2ece0" opacity="0.16" />
      <text x="66" y="66" fontSize="42" textAnchor="middle" fill="#f6f1e4">
        ♞
      </text>
      <text x="98" y="60" fontSize="34" textAnchor="middle" fill="#11151a">
        ♛
      </text>
    </>
  ),
  dominoes: (
    <>
      <g transform="translate(38 30) rotate(-8)">
        <rect width="34" height="52" rx="5" fill="#fbf7ee" stroke="#b3a892" strokeWidth="2" />
        <path d="M2 26 h30" stroke="#b3a892" strokeWidth="2" />
        <circle cx="17" cy="13" r="3.5" fill="#241f1a" />
        <circle cx="10" cy="34" r="3.5" fill="#241f1a" />
        <circle cx="24" cy="42" r="3.5" fill="#241f1a" />
      </g>
      <g transform="translate(84 26) rotate(10)">
        <rect width="34" height="52" rx="5" fill="#fbf7ee" stroke="#b3a892" strokeWidth="2" />
        <path d="M2 26 h30" stroke="#b3a892" strokeWidth="2" />
        <circle cx="10" cy="10" r="3.5" fill="#241f1a" />
        <circle cx="24" cy="18" r="3.5" fill="#241f1a" />
        <circle cx="17" cy="39" r="3.5" fill="#241f1a" />
      </g>
    </>
  ),
  werewolf: (
    <>
      <circle cx="120" cy="26" r="12" fill="#f6f1e4" opacity="0.85" />
      <circle cx="115" cy="23" r="12" fill="#3a1f1f" />
      <path d="M40 84 L54 46 L66 62 L80 34 L94 62 L106 46 L120 84 Z" fill="#150c0c" />
      <circle cx="70" cy="66" r="4" fill="#ff9d8a" />
      <circle cx="90" cy="66" r="4" fill="#ff9d8a" />
    </>
  ),
  codewords: (
    <>
      {[0, 1, 2].map((r) =>
        [0, 1, 2, 3].map((c) => (
          <rect
            key={`${r}${c}`}
            x={30 + c * 26}
            y={22 + r * 22}
            width="22"
            height="18"
            rx="3"
            fill={
              (r === 0 && c === 1) || (r === 2 && c === 2)
                ? "#d0553f"
                : (r === 1 && c === 0) || (r === 1 && c === 3)
                  ? "#3f7fd0"
                  : r === 2 && c === 0
                    ? "#1d1a18"
                    : "#e8e0cf"
            }
          />
        ))
      )}
    </>
  ),
  sketch: (
    <>
      <rect x="30" y="18" width="100" height="64" rx="6" fill="#fdfcf7" />
      <path
        d="M46 66 C 58 40, 70 74, 84 48 S 108 34, 116 52"
        stroke="#1f7ae0"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M104 76 l18 -18 6 6 -18 18 -8 2 z" fill="#e8c85a" stroke="#8a6d1f" strokeWidth="1.5" />
    </>
  ),
  trivia: (
    <>
      <circle cx="80" cy="50" r="34" fill="#f6f1e4" opacity="0.1" />
      <text x="80" y="72" fontSize="58" textAnchor="middle" fill="#f0c674" fontWeight="700">
        ?
      </text>
    </>
  ),
};

export function GameArt({ gameId, className }: GameArtProps) {
  return (
    <svg className={`game-art ${className ?? ""}`} {...FRAME} role="presentation" aria-hidden="true">
      <Backdrop gameId={gameId} />
      {ART[gameId] ?? (
        <text x="80" y="62" fontSize="34" textAnchor="middle" fill="#f6f1e4" opacity="0.6">
          🎲
        </text>
      )}
    </svg>
  );
}
