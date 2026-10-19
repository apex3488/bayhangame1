"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { useGame } from "@/components/game-context";
import { GameRoom, PlayButton, useRound } from "@/components/game-room";

// Sectors sized by the server probabilities (bot SPIN_DEFAULT_CONFIG), split and interleaved for a classic look.
const SECTORS: { m: number; w: number }[] = [
  { m: 0, w: 7 }, { m: 2, w: 6 }, { m: 0.5, w: 11 }, { m: 0, w: 7 }, { m: 5, w: 4 }, { m: 1, w: 9 }, { m: 0, w: 7 },
  { m: 3, w: 7 }, { m: 0.5, w: 11 }, { m: 0, w: 7 }, { m: 10, w: 2 }, { m: 1, w: 9 }, { m: 0, w: 7 }, { m: 2, w: 6 },
];
const COLORS: Record<string, string> = {
  "0": "#1c2234", "0.5": "#3b4766", "1": "#2f7bff", "2": "#10b981", "3": "#a855f7", "5": "#f59e0b", "10": "#ef4444",
};
const TOTAL = SECTORS.reduce((s, x) => s + x.w, 0);
const R = 150;

const arcs = (() => {
  let acc = 0;
  return SECTORS.map((s) => {
    const start = (acc / TOTAL) * 360;
    acc += s.w;
    return { ...s, start, end: (acc / TOTAL) * 360 };
  });
})();

function polar(angle: number, r: number): [number, number] {
  const a = ((angle - 90) * Math.PI) / 180;
  return [R + r * Math.cos(a), R + r * Math.sin(a)];
}

export default function SpinPage() {
  const { t } = useGame();
  const round = useRound<{ multiplier: number }>("spin");
  const [angle, setAngle] = useState(0);
  const [hit, setHit] = useState<number | null>(null);

  async function spin() {
    setHit(null);
    const res = await round.play({});
    if (!res) return;
    const m = Number(res.result.multiplier);
    const candidates = arcs.map((a, i) => ({ a, i })).filter(({ a }) => a.m === m);
    const { a, i } = candidates[Math.floor(Math.random() * candidates.length)];
    const point = a.start + (a.end - a.start) * (0.2 + Math.random() * 0.6);
    // Pointer is at the top (0°); rotate so `point` ends under it, plus 6 full turns.
    setAngle((prev) => {
      const base = Math.ceil(prev / 360) * 360;
      return base + 6 * 360 + (360 - point);
    });
    setTimeout(() => {
      setHit(i);
      round.reveal(res);
    }, 5100);
  }

  const stage = (
    <div className="flex flex-col items-center py-6">
      <div className="relative">
        <div className="absolute left-1/2 top-[-6px] z-10 -translate-x-1/2">
          <svg width="34" height="40" viewBox="0 0 34 40">
            <path d="M17 40 L2 6 Q17 -4 32 6 Z" fill="#ffc94d" stroke="#2a1600" strokeWidth="2" />
          </svg>
        </div>
        <div className="rounded-full bg-gradient-to-b from-[#ffc94d] to-[#ff4d61] p-2 shadow-[0_30px_80px_-20px_rgba(255,77,97,.6)]">
          <motion.svg
            width={R * 2}
            height={R * 2}
            viewBox={`0 0 ${R * 2} ${R * 2}`}
            className="block h-[280px] w-[280px] md:h-[340px] md:w-[340px]"
            animate={{ rotate: angle }}
            transition={{ duration: 5, ease: [0.12, 0.7, 0.1, 1] }}
          >
            {arcs.map((a, i) => {
              const [x1, y1] = polar(a.start, R);
              const [x2, y2] = polar(a.end, R);
              const large = a.end - a.start > 180 ? 1 : 0;
              const mid = (a.start + a.end) / 2;
              const [tx, ty] = polar(mid, R * 0.7);
              return (
                <g key={i}>
                  <path
                    d={`M${R},${R} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`}
                    fill={COLORS[String(a.m)]}
                    stroke="#05060a"
                    strokeWidth="2"
                    opacity={hit === null || hit === i ? 1 : 0.45}
                  />
                  <text
                    x={tx}
                    y={ty}
                    fill="#fff"
                    fontSize={a.w > 5 ? 15 : 11}
                    fontWeight="800"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${mid} ${tx} ${ty})`}
                  >
                    ×{a.m}
                  </text>
                </g>
              );
            })}
            <circle cx={R} cy={R} r="30" fill="#0b1020" stroke="#ffc94d" strokeWidth="4" />
            <text x={R} y={R + 1} fill="#ffc94d" fontSize="13" fontWeight="900" textAnchor="middle" dominantBaseline="middle">
              BAYHAN
            </text>
          </motion.svg>
        </div>
      </div>
    </div>
  );

  return <GameRoom game="spin" round={round} accent="#ff4d61" stage={stage} action={<PlayButton onClick={spin} busy={round.busy} label={t("spin")} />} />;
}
