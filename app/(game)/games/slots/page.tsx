"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { useGame } from "@/components/game-context";
import { GameRoom, PlayButton, useRound } from "@/components/game-room";

const SYMBOLS: Record<string, string> = { cherry: "🍒", lemon: "🍋", orange: "🍊", star: "⭐", diamond: "💎", seven: "7️⃣" };
const KEYS = Object.keys(SYMBOLS);
const CELL = 112;
const SPINS = 18;

interface SlotsResult {
  reels: [string, string, string];
  jackpot: boolean;
}

function randomStrip(final: string): string[] {
  return [...Array.from({ length: SPINS }, () => KEYS[Math.floor(Math.random() * KEYS.length)]), final];
}

export default function SlotsPage() {
  const { t } = useGame();
  const round = useRound<SlotsResult>("slots");
  const [strips, setStrips] = useState<string[][]>([["seven"], ["diamond"], ["seven"]]);
  const [spinId, setSpinId] = useState(0);
  const [win, setWin] = useState<boolean[]>([false, false, false]);

  async function spin() {
    setWin([false, false, false]);
    const res = await round.play({});
    if (!res) return;
    const reels = res.result.reels;
    setStrips(reels.map((r) => randomStrip(r)));
    setSpinId((n) => n + 1);
    setTimeout(() => {
      const [a, b, c] = reels;
      setWin([a === b || a === c, a === b || b === c, a === c || b === c]);
      round.reveal(res);
    }, 2300);
  }

  const stage = (
    <div className="relative mx-auto max-w-xl py-6">
      <div className="mb-5 text-center">
        <motion.p
          animate={{ textShadow: ["0 0 12px #ff3d71", "0 0 26px #7a1fff", "0 0 12px #ff3d71"] }}
          transition={{ duration: 2.4, repeat: Infinity }}
          className="font-display text-3xl font-bold tracking-widest text-white"
        >
          BAYHAN SLOTS
        </motion.p>
      </div>
      <div className="rounded-[28px] bg-gradient-to-b from-[#ff3d71] via-[#a21caf] to-[#4c1d95] p-[3px] shadow-[0_30px_80px_-20px_rgba(162,28,175,.6)]">
        <div className="grid grid-cols-3 gap-2 rounded-[26px] bg-[#0b0614] p-3">
          {strips.map((strip, i) => (
            <div key={i} className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#1a1028] via-[#24143a] to-[#1a1028]" style={{ height: CELL }}>
              <motion.div
                key={`${spinId}-${i}`}
                initial={{ y: 0 }}
                animate={{ y: -(strip.length - 1) * CELL }}
                transition={{ duration: 1.3 + i * 0.45, ease: [0.12, 0.6, 0.22, 1.03] }}
              >
                {strip.map((s, j) => (
                  <div key={j} className="grid place-items-center text-6xl" style={{ height: CELL }}>
                    <span className="drop-shadow-[0_6px_14px_rgba(0,0,0,.6)]">{SYMBOLS[s]}</span>
                  </div>
                ))}
              </motion.div>
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60" />
              {win[i] && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 0.6, 1] }}
                  transition={{ duration: 0.8 }}
                  className="pointer-events-none absolute inset-0 rounded-2xl ring-4 ring-[var(--gold)] shadow-[inset_0_0_30px_rgba(255,201,77,.5)]"
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-5 flex justify-center gap-2">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-[var(--gold)]"
            animate={{ opacity: round.busy ? [0.2, 1, 0.2] : 0.35 }}
            transition={{ duration: 0.6, repeat: round.busy ? Infinity : 0, delay: i * 0.08 }}
          />
        ))}
      </div>
    </div>
  );

  return <GameRoom game="slots" round={round} accent="#a21caf" stage={stage} action={<PlayButton onClick={spin} busy={round.busy} label={t("spin")} />} />;
}
