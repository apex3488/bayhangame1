"use client";

import { motion } from "motion/react";
import { useRef, useState } from "react";
import { useGame } from "@/components/game-context";
import { GameRoom, PlayButton, useRound } from "@/components/game-room";

// Display weights mirror the server config (bot CASINO_DEFAULT_CONFIG); the result itself comes from the server.
const MULTS: [number, number][] = [[0, 40], [0.5, 20], [1, 15], [2, 12], [3, 7], [5, 4], [10, 2]];
const COLORS: Record<string, string> = {
  "0": "#2a3045", "0.5": "#475569", "1": "#2f7bff", "2": "#10b981", "3": "#a855f7", "5": "#f59e0b", "10": "#ef4444",
};
const TILE = 96;
const GAP = 8;
const WIN_INDEX = 44;

function weightedRandom(): number {
  const total = MULTS.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [m, w] of MULTS) {
    if ((r -= w) < 0) return m;
  }
  return 0;
}

function buildStrip(final: number): number[] {
  return Array.from({ length: WIN_INDEX + 6 }, (_, i) => (i === WIN_INDEX ? final : weightedRandom()));
}

export default function CasinoPage() {
  const { t } = useGame();
  const round = useRound<{ multiplier: number }>("casino");
  const box = useRef<HTMLDivElement>(null);
  const [strip, setStrip] = useState<number[]>(() => buildStrip(10));
  const [x, setX] = useState(0);
  const [spinId, setSpinId] = useState(0);
  const [landed, setLanded] = useState(false);

  async function play() {
    setLanded(false);
    const res = await round.play({});
    if (!res) return;
    const next = buildStrip(Number(res.result.multiplier));
    setStrip(next);
    setX(0);
    setSpinId((n) => n + 1);
    const w = box.current?.clientWidth ?? 600;
    // Land slightly off-centre within the tile for a natural stop.
    const jitter = (Math.random() - 0.5) * (TILE * 0.5);
    requestAnimationFrame(() => setX(-(WIN_INDEX * (TILE + GAP)) + w / 2 - TILE / 2 + jitter));
    setTimeout(() => {
      setLanded(true);
      round.reveal(res);
    }, 4300);
  }

  const stage = (
    <div className="py-10">
      <div ref={box} className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[#070a12] py-6">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[#070a12] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[#070a12] to-transparent" />
        <div className="absolute inset-y-2 left-1/2 z-20 w-[3px] -translate-x-1/2 rounded-full bg-[var(--gold)] shadow-[0_0_16px_var(--gold)]" />
        <motion.div
          key={spinId}
          className="flex"
          style={{ gap: GAP, paddingLeft: GAP }}
          initial={{ x: 0 }}
          animate={{ x }}
          transition={{ duration: 4.2, ease: [0.1, 0.75, 0.15, 1] }}
        >
          {strip.map((m, i) => (
            <div
              key={i}
              className="grid shrink-0 place-items-center rounded-2xl border border-white/10"
              style={{
                width: TILE,
                height: TILE,
                background: `linear-gradient(160deg, ${COLORS[String(m)]}, #0b1020)`,
                boxShadow: landed && i === WIN_INDEX ? `0 0 0 3px var(--gold), 0 0 40px ${COLORS[String(m)]}` : undefined,
              }}
            >
              <span className="font-display text-2xl font-bold">×{m}</span>
            </div>
          ))}
        </motion.div>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {MULTS.map(([m, w]) => (
          <span key={m} className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `${COLORS[String(m)]}33`, color: "#fff" }}>
            ×{m} · {w}%
          </span>
        ))}
      </div>
    </div>
  );

  return <GameRoom game="casino" round={round} accent="#10b981" stage={stage} action={<PlayButton onClick={play} busy={round.busy} label={t("play")} />} />;
}
