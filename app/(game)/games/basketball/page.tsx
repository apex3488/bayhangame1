"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { useGame } from "@/components/game-context";
import { GameRoom, PlayButton, useRound } from "@/components/game-room";

// Ball paths in SVG coordinates (start 70,330). Value comes from the server: 4–5 score, 1–3 miss.
const PATHS: Record<number, { x: number[]; y: number[]; label: string }> = {
  5: { x: [70, 160, 250, 310, 318, 318], y: [330, 120, 40, 95, 150, 300], label: "SWISH!" },
  4: { x: [70, 160, 252, 296, 322, 316, 318], y: [330, 120, 40, 92, 88, 150, 300], label: "SCORE!" },
  3: { x: [70, 160, 252, 296, 270, 230, 200], y: [330, 120, 40, 92, 60, 200, 330], label: "RIM OUT" },
  2: { x: [70, 170, 280, 352, 330, 300], y: [330, 110, 20, 40, 200, 330], label: "BRICK" },
  1: { x: [70, 140, 210, 260, 280], y: [330, 170, 120, 220, 330], label: "AIRBALL" },
};

export default function BasketballPage() {
  const { t } = useGame();
  const round = useRound<{ value: number }>("basketball");
  const [shot, setShot] = useState<{ v: number; id: number } | null>(null);
  const [label, setLabel] = useState<string | null>(null);

  async function shoot() {
    setLabel(null);
    const res = await round.play({});
    if (!res) return;
    const v = res.result.value;
    setShot({ v, id: Date.now() });
    setTimeout(() => {
      setLabel(PATHS[v].label);
      round.reveal(res);
    }, 1700);
  }

  const path = shot ? PATHS[shot.v] : null;
  const scored = shot ? shot.v >= 4 : false;

  const stage = (
    <div className="relative">
      <svg viewBox="0 0 400 360" className="block w-full rounded-3xl bg-gradient-to-b from-[#1a0f0a] to-[#2a160c]">
        <defs>
          <radialGradient id="ball" cx="35%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#ffb073" />
            <stop offset="100%" stopColor="#d9480f" />
          </radialGradient>
        </defs>
        {Array.from({ length: 9 }, (_, i) => (
          <rect key={i} x={i * 46} y="300" width="44" height="60" fill={i % 2 ? "#5a3216" : "#6b3c1b"} />
        ))}
        <path d="M0,300 Q200,250 400,300" fill="none" stroke="#f5d0a9" strokeOpacity=".25" strokeWidth="3" />
        <rect x="350" y="20" width="10" height="150" fill="#cbd5e1" />
        <rect x="335" y="30" width="16" height="70" rx="2" fill="#f8fafc" stroke="#ef4444" strokeWidth="2" />
        <rect x="339" y="52" width="9" height="22" fill="none" stroke="#ef4444" strokeWidth="2" />
        <motion.g
          key={`net-${shot?.id}`}
          animate={scored ? { scaleY: [1, 1.35, 1] } : {}}
          transition={{ delay: 1.2, duration: 0.5 }}
          style={{ transformOrigin: "318px 92px" }}
        >
          <path d="M298,92 L304,130 L332,130 L338,92" fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="1.5" />
          <path d="M302,104 L334,104 M303,117 L333,117 M310,92 L314,130 M326,92 L322,130" stroke="#fff" strokeOpacity=".5" strokeWidth="1" />
        </motion.g>
        <motion.g key={shot?.id ?? "idle"} initial={{ x: 70, y: 330 }} animate={path ? { x: path.x, y: path.y, rotate: 540 } : { x: 70, y: 330 }}
          transition={{ duration: 1.6, ease: "easeInOut" }}>
          <circle r="16" fill="url(#ball)" />
          <path d="M-16,0 L16,0 M0,-16 L0,16" stroke="#7c2d12" strokeWidth="1.5" />
          <path d="M-11,-11 Q0,0 -11,11 M11,-11 Q0,0 11,11" stroke="#7c2d12" strokeWidth="1.5" fill="none" />
        </motion.g>
        <ellipse cx="318" cy="92" rx="21" ry="5" fill="none" stroke="#f97316" strokeWidth="4" />
      </svg>
      {label && (
        <motion.div
          initial={{ scale: 0.4, opacity: 0, rotate: -8 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 14 }}
          className={`font-display absolute left-1/2 top-10 -translate-x-1/2 rounded-2xl px-5 py-2 text-2xl font-black ${
            scored ? "bg-[var(--success)] text-black" : "bg-black/70 text-white"
          }`}
        >
          {label}
        </motion.div>
      )}
    </div>
  );

  return <GameRoom game="basketball" round={round} accent="#ff8a3d" stage={stage} action={<PlayButton onClick={shoot} busy={round.busy} label={t("throw")} />} />;
}
