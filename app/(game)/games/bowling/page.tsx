"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { useGame } from "@/components/game-context";
import { GameRoom, PlayButton, useRound } from "@/components/game-room";

// Pins knocked down for each server value (6 = strike).
const KNOCK: Record<number, number> = { 6: 10, 5: 9, 4: 7, 3: 5, 2: 3, 1: 0 };
const LABEL: Record<number, string> = { 6: "STRIKE!", 5: "9 PINS", 4: "7 PINS", 3: "5 PINS", 2: "3 PINS", 1: "GUTTER" };
// Pin positions (x, y) in a triangle at the far end of the lane.
const PINS: [number, number][] = [
  [200, 120], [188, 104], [212, 104], [176, 88], [200, 88], [224, 88], [164, 72], [188, 72], [212, 72], [236, 72],
];

interface Fall {
  rotate: number;
  x: number;
  y: number;
  delay: number;
}

export default function BowlingPage() {
  const { t } = useGame();
  const round = useRound<{ value: number }>("bowling");
  const [roll, setRoll] = useState<{ v: number; id: number; down: Map<number, Fall>; lane: number } | null>(null);
  const [label, setLabel] = useState<string | null>(null);

  async function bowl() {
    setLabel(null);
    const res = await round.play({});
    if (!res) return;
    const v = res.result.value;
    const n = KNOCK[v];
    // Front pins fall first, so take the n pins nearest to the head pin.
    const order = PINS.map((_, i) => i).sort(() => Math.random() - 0.5).sort((a, b) => PINS[b][1] - PINS[a][1] + (Math.random() - 0.5) * 20);
    const down = new Map<number, Fall>(
      order.slice(0, n).map((i) => [
        i,
        {
          rotate: (Math.random() < 0.5 ? -1 : 1) * (70 + Math.random() * 40),
          x: (PINS[i][0] - 200) * 0.8 + (Math.random() - 0.5) * 30,
          y: -10 - Math.random() * 20,
          delay: 1.45 + Math.random() * 0.25,
        },
      ]),
    );
    setRoll({ v, id: Date.now(), down, lane: v === 1 ? (Math.random() < 0.5 ? 150 : 250) : 200 + (Math.random() - 0.5) * 16 });
    setTimeout(() => {
      setLabel(LABEL[v]);
      round.reveal(res);
    }, 2100);
  }

  const stage = (
    <div className="relative">
      <svg viewBox="0 0 400 380" className="block w-full rounded-3xl bg-[#0a0d16]">
        <defs>
          <linearGradient id="lane" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#7c4a1e" />
            <stop offset="100%" stopColor="#c8873f" />
          </linearGradient>
          <radialGradient id="bball" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#7fb2ff" />
            <stop offset="100%" stopColor="#1e3a8a" />
          </radialGradient>
        </defs>
        <path d="M150,40 L250,40 L330,380 L70,380 Z" fill="url(#lane)" />
        <path d="M142,40 L150,40 L70,380 L52,380 Z" fill="#1f2937" />
        <path d="M250,40 L258,40 L348,380 L330,380 Z" fill="#1f2937" />
        {Array.from({ length: 7 }, (_, i) => (
          <path key={i} d={`M${200 + (i - 3) * 6},${300} l${(i - 3) * 1.5},10 l-4,0 Z`} fill="#3b2110" opacity=".6" />
        ))}
        {PINS.map(([x, y], i) => {
          const fall = roll?.down.get(i);
          return (
            <motion.g
              key={`${roll?.id}-${i}`}
              initial={{ rotate: 0, x: 0, y: 0, opacity: 1 }}
              animate={fall ? { rotate: fall.rotate, x: fall.x, y: fall.y, opacity: 0.25 } : {}}
              transition={{ delay: fall?.delay ?? 0, duration: 0.5, ease: "easeOut" }}
              style={{ transformOrigin: `${x}px ${y + 8}px` }}
            >
              <ellipse cx={x} cy={y + 9} rx="6" ry="2" fill="#000" opacity=".35" />
              <path d={`M${x - 4},${y + 8} Q${x - 6},${y} ${x - 2.5},${y - 4} Q${x - 4},${y - 10} ${x},${y - 12} Q${x + 4},${y - 10} ${x + 2.5},${y - 4} Q${x + 6},${y} ${x + 4},${y + 8} Z`} fill="#f8fafc" />
              <rect x={x - 3} y={y - 5} width="6" height="2" fill="#dc2626" />
            </motion.g>
          );
        })}
        <motion.g
          key={roll?.id ?? "idle"}
          initial={{ x: 200, y: 350, scale: 1 }}
          animate={roll ? { x: [200, roll.lane, roll.lane], y: [350, 200, 100], scale: [1, 0.7, 0.45] } : { x: 200, y: 350 }}
          transition={{ duration: 1.5, ease: "easeIn" }}
        >
          <circle r="22" fill="url(#bball)" />
          <circle cx="-6" cy="-7" r="3" fill="#0b1020" />
          <circle cx="3" cy="-9" r="3" fill="#0b1020" />
          <circle cx="-2" cy="1" r="3" fill="#0b1020" />
        </motion.g>
      </svg>
      {label && (
        <motion.div
          initial={{ scale: 0.4, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 14 }}
          className={`font-display absolute left-1/2 top-4 -translate-x-1/2 rounded-2xl px-5 py-2 text-2xl font-black ${roll && roll.v >= 5 ? "bg-[var(--success)] text-black" : "bg-black/75 text-white"}`}
        >
          {label}
        </motion.div>
      )}
    </div>
  );

  return <GameRoom game="bowling" round={round} accent="#2f7bff" stage={stage} action={<PlayButton onClick={bowl} busy={round.busy} label={t("throw")} />} />;
}
