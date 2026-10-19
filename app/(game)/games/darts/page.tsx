"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { useGame } from "@/components/game-context";
import { GameRoom, PlayButton, useRound } from "@/components/game-room";

const C = 180;
// Distance from the centre for each server value: 6 bullseye … 1 off the board.
const RING: Record<number, [number, number]> = { 6: [0, 8], 5: [16, 30], 4: [40, 62], 3: [70, 100], 2: [108, 132], 1: [150, 168] };
const LABEL: Record<number, string> = { 6: "BULLSEYE!", 5: "INNER RING", 4: "TRIPLE", 3: "SINGLE", 2: "DOUBLE OUT", 1: "MISS" };

export default function DartsPage() {
  const { t } = useGame();
  const round = useRound<{ value: number }>("darts");
  const [hit, setHit] = useState<{ x: number; y: number; v: number; id: number } | null>(null);
  const [label, setLabel] = useState<string | null>(null);

  async function throwDart() {
    setLabel(null);
    const res = await round.play({});
    if (!res) return;
    const v = res.result.value;
    const [lo, hi] = RING[v];
    const r = lo + Math.random() * (hi - lo);
    const a = Math.random() * Math.PI * 2;
    setHit({ x: C + Math.cos(a) * r, y: C + Math.sin(a) * r, v, id: Date.now() });
    setTimeout(() => {
      setLabel(LABEL[v]);
      round.reveal(res);
    }, 1000);
  }

  const segments = Array.from({ length: 20 }, (_, i) => i);
  const wedge = (r1: number, r2: number, i: number) => {
    const a1 = ((i * 18 - 9 - 90) * Math.PI) / 180;
    const a2 = (((i + 1) * 18 - 9 - 90) * Math.PI) / 180;
    const p = (r: number, a: number) => `${C + r * Math.cos(a)},${C + r * Math.sin(a)}`;
    return `M${p(r1, a1)} L${p(r2, a1)} A${r2},${r2} 0 0 1 ${p(r2, a2)} L${p(r1, a2)} A${r1},${r1} 0 0 0 ${p(r1, a1)} Z`;
  };

  const stage = (
    <div className="relative flex justify-center py-4">
      <motion.svg
        viewBox="0 0 360 360"
        className="h-[300px] w-[300px] md:h-[380px] md:w-[380px]"
        animate={hit ? { x: [0, -4, 3, 0], y: [0, 2, -2, 0] } : {}}
        transition={{ delay: 0.75, duration: 0.25 }}
        key={hit?.id ?? "board"}
      >
        <circle cx={C} cy={C} r="178" fill="#111" stroke="#3f3f46" strokeWidth="4" />
        {segments.map((i) => (
          <g key={i}>
            <path d={wedge(100, 138, i)} fill={i % 2 ? "#f5f0e1" : "#111"} />
            <path d={wedge(138, 146, i)} fill={i % 2 ? "#16a34a" : "#dc2626"} />
            <path d={wedge(62, 100, i)} fill={i % 2 ? "#f5f0e1" : "#111"} />
            <path d={wedge(54, 62, i)} fill={i % 2 ? "#16a34a" : "#dc2626"} />
            <path d={wedge(16, 54, i)} fill={i % 2 ? "#f5f0e1" : "#111"} />
          </g>
        ))}
        <circle cx={C} cy={C} r="16" fill="#16a34a" />
        <circle cx={C} cy={C} r="8" fill="#dc2626" />
        {hit && (
          <motion.g initial={{ x: 0, y: 260, scale: 2.2, opacity: 0 }} animate={{ x: 0, y: 0, scale: 1, opacity: 1 }} transition={{ duration: 0.75, ease: [0.3, 0.9, 0.3, 1] }}>
            <line x1={hit.x} y1={hit.y} x2={hit.x + 34} y2={hit.y + 26} stroke="#e5e7eb" strokeWidth="3" />
            <path d={`M${hit.x + 30},${hit.y + 22} l12,2 l-4,10 Z`} fill="#2f7bff" />
            <circle cx={hit.x} cy={hit.y} r="3.5" fill="#fbbf24" stroke="#000" />
          </motion.g>
        )}
        {hit && (
          <motion.circle cx={hit.x} cy={hit.y} r="4" fill="none" stroke="#fbbf24" strokeWidth="2"
            initial={{ r: 4, opacity: 1 }} animate={{ r: 34, opacity: 0 }} transition={{ delay: 0.75, duration: 0.6 }} />
        )}
      </motion.svg>
      {label && (
        <motion.div
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 14 }}
          className={`font-display absolute top-4 rounded-2xl px-5 py-2 text-xl font-black ${hit && hit.v >= 5 ? "bg-[var(--success)] text-black" : "bg-black/75 text-white"}`}
        >
          {label}
        </motion.div>
      )}
    </div>
  );

  return <GameRoom game="darts" round={round} accent="#f43f5e" stage={stage} action={<PlayButton onClick={throwDart} busy={round.busy} label={t("throw")} />} />;
}
